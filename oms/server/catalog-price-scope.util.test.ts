import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogQuoteCustomer } from './catalog-price-scope.util.js'
import type { AuthClaims } from './auth.js'
import { fetchErpCatalog, fetchErpCatalogSku } from './erpClient.js'
const customer: AuthClaims = { userId: 'u1', customerId: 'c1', customerCode: 'TKL9001', role: 'catalog', permissions: ['catalog:read'], mustChangePassword: false }
test('客户报价只取登录身份，伪造其他客户或档位不改变报价范围', () => {
  for (const requested of [undefined, 'TKL9002', 'A', 'B', { customerCode: 'TKL9002' }]) assert.equal(catalogQuoteCustomer(customer, requested), 'TKL9001')
})
test('管理员可以指定客户查看报价，未指定时使用基础目录', () => {
  const admin = { ...customer, role: 'sys_admin' as const, customerCode: null, customerId: null }
  assert.equal(catalogQuoteCustomer(admin), undefined); assert.equal(catalogQuoteCustomer(admin, 'tkl9002'), 'TKL9002')
  assert.throws(() => catalogQuoteCustomer(admin, ''))
})
test('无登录身份或缺少客户绑定时不返回未限定范围的价格', () => {
  assert.throws(() => catalogQuoteCustomer(undefined)); assert.throws(() => catalogQuoteCustomer({ ...customer, customerCode: null }))
})
test('目录与单商品请求均将登录客户传给ERP，管理员基础目录不带客户参数', async t => {
  const originalFetch = globalThis.fetch, originalToken = process.env.OMS_INTERNAL_TOKEN
  process.env.OMS_INTERNAL_TOKEN = 'test-only-internal-token-with-at-least-32-chars'
  t.after(() => { globalThis.fetch = originalFetch; if (originalToken === undefined) delete process.env.OMS_INTERNAL_TOKEN; else process.env.OMS_INTERNAL_TOKEN = originalToken })
  const requests: string[] = []
  globalThis.fetch = async input => {
    const url = new URL(String(input)); requests.push(url.pathname + url.search)
    const item = { sku: 'TKL-A', price: 8, priceTier: 'B', priceConfigured: true, imageUrl: null }
    return Response.json({ code: 0, data: url.pathname.endsWith('/TKL-A') ? item : { items: [item], total: 1 } })
  }
  assert.equal((await fetchErpCatalog(catalogQuoteCustomer(customer, 'TKL9002'))).items[0].price, 8)
  assert.equal((await fetchErpCatalogSku('TKL-A', catalogQuoteCustomer(customer, 'TKL9002'))).priceTier, 'B')
  await fetchErpCatalog()
  assert.deepEqual(requests.map(p => p.replace(/^.*\/pricing\//, '/pricing/')), [
    '/pricing/oms/catalog?customerCode=TKL9001', '/pricing/oms/catalog/TKL-A?customerCode=TKL9001', '/pricing/oms/catalog',
  ])
})
