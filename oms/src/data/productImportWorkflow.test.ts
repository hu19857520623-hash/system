import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProducts, PRODUCT_COLUMNS } from './importTemplates'
import { mapCsvRows } from './csvImportExport'
import { clearProductImportAttempt, prepareProductImport, readProductImportAttempt, runProductImportAttempt, saveProductImportAttempt, type ProductImportAttempt } from './productImportWorkflow'

const record = (sku: string, lineNo = 2) => ({ internalSku: sku, name: '隔离导入商品', declaredNameEn: 'Fixture', declaredNameEnDecl: 'Fixture', declaredNameCn: '隔离导入商品', unit: 'PCS', weightKg: '1', lengthCm: '2', widthCm: '3', heightCm: '4', declaredValue: '5', _sourceLineNo: String(lineNo) })
const prepare = (rows = [record('IM43A')]) => prepareProductImport(parseProducts(rows, 'c1'), [], 'c1', 'TKL9001')
function attempt(): ProductImportAttempt { return JSON.parse(JSON.stringify({ requestId: crypto.randomUUID(), userId: 'u1', customerId: 'c1', ...prepare() })) }
function storage() { const rows = new Map<string,string>(); return { rows, getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } } }

test('501 source rows are rejected before creating a batch; exactly 500 retain distinct bounded IDs', () => {
  assert.throws(() => prepare(Array.from({ length: 501 }, (_, i) => record(`A${i}`, i + 2))), /501.*最多导入500.*尚未提交/)
  const result = prepare(Array.from({ length: 500 }, (_, i) => record(`A${i}`, i + 2)))
  assert.equal(result.products.length, 500); assert.equal(new Set(result.products.map(row => row.id)).size, 500)
  assert.ok(result.products.every(row => row.id.length <= 50 && row.productStatus === 'draft' && row.availableQty === 0 && !('sourceLineNo' in row)))
})
test('physical CSV lines, required failures, numeric failures and duplicate SKUs remain accountable beside valid rows', () => {
  const headers = PRODUCT_COLUMNS.map(column => column.header)
  const values = (sku: string) => PRODUCT_COLUMNS.map(column => record(sku)[column.key as keyof ReturnType<typeof record>] || '')
  const missing = values('EMPTY43'); missing[1] = ''
  const invalid = values('BAD43'); invalid[8] = '-1'
  const mapped = mapCsvRows([headers, values('GOOD43'), missing, invalid, values('good43')], PRODUCT_COLUMNS)
  const parsed = parseProducts(mapped.records, 'c1')
  const result = prepareProductImport({ ...parsed, failures: [...mapped.failures, ...parsed.failures] }, [], 'c1', 'TKL9001')
  assert.equal(result.rowCount, 4); assert.equal(result.products.length, 1)
  assert.deepEqual(result.failures.map(row => row.lineNo).sort(), [3, 4, 5])
  assert.ok(result.failures.every(row => /[\u4e00-\u9fff]/.test(row.reason)))
})
test('existing customer/global SKU duplicates fail their own row and do not suppress other valid rows', () => {
  const existing = prepare().products
  const result = prepareProductImport(parseProducts([record('IM43A'), record('IM43B', 8)], 'c1'), existing, 'c1', 'TKL9001')
  assert.equal(result.products[0].customerSku, 'IM43B'); assert.equal(result.failures[0].lineNo, 2)
})
test('stored batch survives reload, is isolated by actor/customer, and cannot be replaced while unresolved', () => {
  const s = storage(), original = attempt(); saveProductImportAttempt(s, original)
  assert.deepEqual(readProductImportAttempt(s, 'u1', 'c1'), original)
  assert.equal(readProductImportAttempt(s, 'u2', 'c1'), null); assert.equal(readProductImportAttempt(s, 'u1', 'c2'), null)
  assert.throws(() => saveProductImportAttempt(s, attempt()), /原导入批次待核对/)
  assert.throws(() => clearProductImportAttempt(s, { ...original, requestId: crypto.randomUUID() }), /批次已变化/)
  clearProductImportAttempt(s, original); assert.equal(readProductImportAttempt(s, 'u1', 'c1'), null)
})
test('storage write failures stop submission and malformed recovery data is not silently discarded', () => {
  const original = attempt(), s = storage()
  assert.throws(() => saveProductImportAttempt({ ...s, setItem: () => { throw Error('quota') } }, original), /尚未提交/)
  saveProductImportAttempt(s, original); const [key] = s.rows.keys(); s.rows.set(key, '{')
  assert.throws(() => readProductImportAttempt(s, 'u1', 'c1'), /原导入批次无法读取/); assert.equal(s.rows.get(key), '{')
})
test('network, authorization and server errors preserve the exact original batch for recovery', async () => {
  for (const status of [0, 401, 403, 500]) {
    const s = storage(), original = attempt(); saveProductImportAttempt(s, original)
    await assert.rejects(runProductImportAttempt(async () => { throw Object.assign(new Error('NetworkError'), { status }) }, original, 'old', () => 'old'), /原导入批次已保留/)
    assert.deepEqual(readProductImportAttempt(s, 'u1', 'c1'), original)
  }
})
test('late results after login or permission changes cannot confirm or clear another identity', async () => {
  const s = storage(), original = attempt(); saveProductImportAttempt(s, original)
  let owner: string | null = 'old', release!: (value: any) => void
  const pending = runProductImportAttempt(() => new Promise(resolve => { release = resolve }), original, owner, () => owner)
  owner = null; release({ requestId: original.requestId, status: 'confirmed', count: 1, productIds: original.products.map(row => row.id) })
  await assert.rejects(pending, /权限已变化/); assert.deepEqual(readProductImportAttempt(s, 'u1', 'c1'), original)
  let called = false
  await assert.rejects(runProductImportAttempt(async () => { called = true; throw Error() }, original, 'old', () => 'new'))
  assert.equal(called, false)
})
test('unknown and malformed receipts never clear recovery; only exact IDs and counts confirm the batch', async () => {
  const original = attempt(), ids = original.products.map(row => row.id)
  const request = (result: any) => runProductImportAttempt(async () => result, original, 'owner', () => 'owner')
  for (const result of [{}, { requestId: 'other', status: 'unknown' }, { requestId: original.requestId, status: 'confirmed', count: 1, productIds: ['other'] }, { requestId: original.requestId, status: 'cancelled', count: 1, productIds: ids }]) await assert.rejects(request(result), /回执/)
  assert.equal((await request({ requestId: original.requestId, status: 'unknown' })).status, 'unknown')
  assert.equal((await request({ requestId: original.requestId, status: 'confirmed', count: 1, productIds: ids })).status, 'confirmed')
  assert.equal((await request({ requestId: original.requestId, status: 'cancelled', count: 0, productIds: [] })).status, 'cancelled')
})
