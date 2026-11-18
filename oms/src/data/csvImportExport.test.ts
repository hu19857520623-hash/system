import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCsvRows, parseCsv, pickCsvFile, readImportFileText } from './csvImportExport.ts'
import { PLATFORM_BINDING_COLUMNS, PLATFORM_BINDING_IMPORT_COLUMNS, PRODUCT_COLUMNS, parsePlatformBindings, parseProducts } from './importTemplates.ts'
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

test('商品导入必须有产品名称EN；省略申报英文和单位时使用英文名称及PCS', () => {
  const headers = '产品SKU,产品名称,产品名称EN *,申报价值,中文申报品名,产品重量KG,长CM,宽CM,高CM'
  const valid = 'ABC,示例商品,Example item,12,示例,0.5,10,15,20'
  const missingEnglish = 'DEF,另一个商品,,23,示例,0.4,10,15,20'
  const mapped = mapCsvRows(parseCsv(`${headers}\n${valid}\n${missingEnglish}`), PRODUCT_COLUMNS)
  assert.equal(mapped.records.length, 1)
  assert.match(mapped.failures[0].reason, /产品名称EN/)
  const result = parseProducts(mapped.records)
  assert.equal(result.data[0].declaredNameEn, 'Example item')
  assert.equal(result.data[0].unit, 'PCS')

  const legacy = mapCsvRows(parseCsv(`${headers},英文申报品名 *,产品单位 *\n${valid},Custom declaration,BOX`), PRODUCT_COLUMNS)
  const legacyResult = parseProducts(legacy.records)
  assert.equal(legacyResult.data[0].declaredNameEn, 'Custom declaration')
  assert.equal(legacyResult.data[0].unit, 'BOX')
})

test('990 新模板只填写条码和客户 SKU，旧模板保留已填写的组合数量', () => {
  const products = [
    { customerId: 'owner-a', internalSku: 'C001-MOUSE', customerSku: 'MOUSE', name: '鼠标', inCatalog: false },
    { customerId: 'owner-b', internalSku: 'C002-MOUSE', customerSku: 'MOUSE', name: '其他客户鼠标', inCatalog: false },
  ]
  assert.deepEqual(PLATFORM_BINDING_COLUMNS.map(column => column.header), ['990条码', '客户自定义SKU'])
  const current = mapCsvRows(parseCsv('990条码*,客户自定义SKU*\n9901234567890,MOUSE\n9901234567891,UNKNOWN'), PLATFORM_BINDING_IMPORT_COLUMNS)
  const result = parsePlatformBindings(current.records, [], products, 'owner-a')
  assert.equal(result.data[0].lines[0].internalSku, 'C001-MOUSE')
  assert.equal(result.data[0].lines[0].qty, 1)
  assert.equal(result.failures[0].lineNo, 3)

  const legacy = mapCsvRows(parseCsv('990条码*,仓库商品编码*,库存来源*,仓库商品数量*\n9901234567890,C001-MOUSE,自有库存,2'), PLATFORM_BINDING_IMPORT_COLUMNS)
  assert.deepEqual(legacy.errors, [])
  assert.equal(parsePlatformBindings(legacy.records, [], products, 'owner-a').data[0].lines[0].qty, 2)
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
