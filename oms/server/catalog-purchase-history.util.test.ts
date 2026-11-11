import assert from 'node:assert/strict'
import test from 'node:test'
import { readCatalogPurchaseHistory } from './catalog-purchase-history.util.js'

const account = { id: 'c1', code: 'TKL9069' }
const purchase = { id: 'mirror', purchaseNo: 'CAT-old', customerId: 'c1', sku: 'TKL-A', qty: 2, createdAt: '2026-10-31 05:00:00' }
const receipt = { orderNo: 'CAT-old', customerCode: 'TKL9069', sku: 'TKL-A', quantity: 2, unitPrice: '40.00', totalAmount: '80.00', createdAt: new Date('2026-10-30T05:00:00Z') }

test('同一SKU不同批购买按各原单金额和时间展示，调价不改写历史', async () => {
  const db = { $queryRaw: async (sql: any) => {
    assert.match(sql.sql, /FROM oms_catalog_order/)
    assert.doesNotMatch(sql.sql, /product_pricing/)
    assert.deepEqual(sql.values, ['CAT-old', 'CAT-new'])
    return [receipt, { ...receipt, orderNo: 'CAT-new', unitPrice: '44.00', totalAmount: '88.00' }]
  } }
  const result = await readCatalogPurchaseHistory(db as any, [purchase, { ...purchase, purchaseNo: 'CAT-new' }], [account])
  assert.deepEqual(result.map(row => [row.unitPrice, row.totalAmount]), [[40, 80], [44, 88]])
  assert.equal(result[0].createdAt, '2026-10-30 05:00:00')
})

test('其它客户、其它商品或不一致数量的原单不泄露金额，也不用当前价猜测', async () => {
  for (const changed of [{ customerCode: 'TKL9001' }, { sku: 'TKL-B' }, { quantity: 3 }]) {
    const db = { $queryRaw: async () => [{ ...receipt, ...changed }] }
    const [result] = await readCatalogPurchaseHistory(db as any, [purchase], [account])
    assert.equal(result.unitPrice, null)
    assert.equal(result.totalAmount, null)
    assert.equal(result.createdAt, purchase.createdAt)
  }
})

test('没有原始扣款凭据的旧镜像金额待核对，空列表不查询', async () => {
  let queries = 0
  const db = { $queryRaw: async () => { queries++; return [] } }
  assert.deepEqual(await readCatalogPurchaseHistory(db as any, [], [account]), [])
  assert.equal(queries, 0)
  const [result] = await readCatalogPurchaseHistory(db as any, [{ ...purchase, totalAmount: 999 }], [account])
  assert.equal(result.totalAmount, null)
  assert.equal(queries, 1)
})
