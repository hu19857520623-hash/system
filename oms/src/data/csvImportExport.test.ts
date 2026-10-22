import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCsvRows, parseCsv, pickCsvFile, readImportFileText } from './csvImportExport.ts'
import { notifyIfUserError, subscribeUserToast } from '../utils/userNotify.ts'

const columns = [
  { key: 'sku', header: 'SKU', required: true },
  { key: 'qty', header: '数量', required: true },
]

test('CSV import retains the original row number for validation errors', async () => {
  const file = new File(['SKU,数量\nA-001,2\nA-002,'], 'items.csv', { type: 'text/csv' })
  const content = await readImportFileText(file, columns)
  const mapped = mapCsvRows(parseCsv(content.text), columns, content.lineOffset)

  assert.equal(mapped.records[0].sku, 'A-001')
  assert.equal(mapped.records[0]._sourceLineNo, '2')
  assert.equal(mapped.failures[0].lineNo, 3)
})

test('binary legacy XLS is rejected with an actionable conversion message', async () => {
  const file = new File([Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0])], 'items.xls')
  await assert.rejects(readImportFileText(file, columns), /另存为 \.xlsx/)
})

test('cancelling the file picker settles the import without an error toast and permits another selection', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const inputs: { oncancel?: () => void; onchange?: () => Promise<void>; files?: File[]; click: () => void }[] = []
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => { const input = { click() {} }; inputs.push(input); return input },
  } })
  const toasts: string[] = []
  const unsubscribe = subscribeUserToast(toast => toasts.push(toast.text))
  t.after(() => { unsubscribe(); if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document') })
  const cancelled = pickCsvFile().catch(error => { notifyIfUserError(error); return error.message })
  inputs[0].oncancel?.()
  assert.equal(await Promise.race([cancelled, new Promise(resolve => setImmediate(() => resolve('pending')))]), 'cancelled')
  assert.deepEqual(toasts, [])
  const selected = pickCsvFile(undefined, columns)
  inputs[1].files = [new File(['SKU,数量\nA-001,2'], 'items.csv', { type: 'text/csv' })]
  await inputs[1].onchange?.()
  assert.equal((await selected).text, 'SKU,数量\nA-001,2')
})
