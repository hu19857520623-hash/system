import assert from 'node:assert/strict'
import test from 'node:test'
import { readCatalogAttempts, saveCatalogAttempt, runCatalogAttempt, type CatalogPurchaseAttempt } from './catalogPurchaseWorkflow'
function storage() { const rows = new Map<string, string>();return { getItem: (key: string) => rows.get(key) || null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } } }
const attempt: CatalogPurchaseAttempt = { orderNo: 'CAT-original', customerId: 'c1', customerCode: 'TKL9001', sku: 'TKL-A', name: '测试货盘', quantity: 1, unitPrice: 10 }
test('采购恢复按原账号和客户范围保存，不能覆盖原数量/报价', () => {
  const s = storage();saveCatalogAttempt(s, 'u1', attempt)
  assert.deepEqual(readCatalogAttempts(s, 'u2', 'c1'), []);assert.deepEqual(readCatalogAttempts(s, 'u1', 'c2'), [])
  assert.throws(() => saveCatalogAttempt(s, 'u1', { ...attempt, quantity: 2 }), /不能修改数量或报价/)
})
for (const status of [401, 403, 429, 500, 503, undefined]) test(`采购失败${status}保留原单号和内容，重试成功后才清除`, async () => {
  const s = storage();saveCatalogAttempt(s, 'u1', attempt);const calls: unknown[] = [];let n = 0, applied = 0
  const request = async (body: CatalogPurchaseAttempt) => { calls.push(body);if (++n === 1) throw { status, message: 'Forbidden' };return { currentBalance: 40, syncPending: false } }
  await assert.rejects(runCatalogAttempt(request, s, 'u1', attempt, () => { applied++ }), /原采购单已保留/)
  assert.deepEqual(readCatalogAttempts(s, 'u1', 'c1'), [attempt]);assert.equal(applied, 0)
  assert.equal((await runCatalogAttempt(request, s, 'u1', attempt, () => { applied++ })).completed, true)
  assert.deepEqual(calls, [attempt, attempt]);assert.equal(applied, 1);assert.deepEqual(readCatalogAttempts(s, 'u1', 'c1'), [])
})
test('服务端已保存但同步失败时保留原采购，不能当作没有购买', async () => {
  const s = storage();saveCatalogAttempt(s, 'u1', attempt);let applied = false
  const result = await runCatalogAttempt(async () => ({ syncPending: true }), s, 'u1', attempt, () => { applied = true })
  assert.equal(result.completed, false);assert.equal(applied, false);assert.match(result.message, /勿再次购买/);assert.deepEqual(readCatalogAttempts(s, 'u1', 'c1'), [attempt])
})
for (const status of [400, 404, 409, 422]) test(`采购明确拒绝${status}后允许刷新报价并重新核对`, async () => {
  const s = storage();saveCatalogAttempt(s, 'u1', attempt)
  await assert.rejects(runCatalogAttempt(async () => { throw { status } }, s, 'u1', attempt, () => {}), /请核对最新商品和余额/)
  assert.deepEqual(readCatalogAttempts(s, 'u1', 'c1'), [])
})
test('本地应用结果失败仍保留已提交原采购号', async () => {
  const s = storage();saveCatalogAttempt(s, 'u1', attempt)
  await assert.rejects(runCatalogAttempt(async () => ({}), s, 'u1', attempt, () => { throw Error('登录账号已变化') }), /原采购单已保留/)
  assert.deepEqual(readCatalogAttempts(s, 'u1', 'c1'), [attempt])
})
test('存储损坏和写入失败给中文反馈，阻止覆盖未知原操作', () => {
  const s = storage();s.setItem('oms:catalog-purchase:["u1","c1"]', '{broken')
  assert.throws(() => readCatalogAttempts(s, 'u1', 'c1'), /原采购核对信息无法读取/)
  assert.throws(() => saveCatalogAttempt({ ...storage(), setItem: () => { throw Error('SecurityError') } }, 'u1', attempt), /本次尚未提交/)
})
