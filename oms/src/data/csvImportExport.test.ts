import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCsvRows, parseCsv, readImportFileText } from './csvImportExport.ts'

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
