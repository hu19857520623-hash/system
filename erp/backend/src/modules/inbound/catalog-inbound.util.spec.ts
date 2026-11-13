import { isCatalogPurchaseInbound } from './catalog-inbound.util'

describe('catalog eligibility by actual product ownership', () => {
  const order = { sourceWarehouseCode: 'LW-SZ-01', omsCustomerCode: null,
    items: [{ productId: 386n, sku: 'FUR-BED-MAT-002' }, { productId: 5n, sku: 'TK-99001' }] }
  const products = order.items.map(item => ({ id: item.productId, sku: item.sku, remark: null }))
  const db = (rows = products) => ({ product: { findMany: jest.fn().mockResolvedValue(rows) } }) as any
  it('accepts legacy category and numeric SKU codes without renaming them', async () => {
    await expect(isCatalogPurchaseInbound(order, db())).resolves.toBe(true)
    for (const sku of ['TOY-ACT-001', '123456', 'TKL-123', 'AFU0430-OLD']) {
      await expect(isCatalogPurchaseInbound({ ...order, items: [{ productId: 1n, sku }] }, db([{ id: 1n, sku, remark: null }]))).resolves.toBe(true)
    }
  })
  it('rejects OMS products, missing products and mismatched product IDs even with platform-looking codes', async () => {
    await expect(isCatalogPurchaseInbound(order, db([]))).resolves.toBe(false)
    await expect(isCatalogPurchaseInbound(order, db([{ ...products[0], sku: 'OTHER' }, products[1]]))).resolves.toBe(false)
    await expect(isCatalogPurchaseInbound(order, db([{ ...products[0], remark: 'OMS客户:TKL9001' } as any, products[1]]))).resolves.toBe(false)
  })
  it('requires procurement origin and rejects customer reservations', async () => {
    for (const invalid of [{ ...order, sourceWarehouseCode: null }, { ...order, omsCustomerCode: 'TKL9001' }, { ...order, items: [] }]) {
      const client = db()
      await expect(isCatalogPurchaseInbound(invalid, client)).resolves.toBe(false)
      expect(client.product.findMany).not.toHaveBeenCalled()
    }
  })
})
