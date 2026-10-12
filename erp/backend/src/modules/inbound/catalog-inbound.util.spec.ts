import { isCatalogPurchaseInbound } from './catalog-inbound.util'

describe('ERP catalog purchase inbound eligibility', () => {
  const order = { sourceWarehouseCode: 'CN01', omsCustomerCode: null, items: [{ sku: 'TKL-719110' }] }
  it('accepts ERP catalog shipments and legacy platform SKUs', () => {
    expect(isCatalogPurchaseInbound(order)).toBe(true)
    expect(isCatalogPurchaseInbound({ ...order, items: [{ sku: 'TK-719110' }, { sku: '710667' }] })).toBe(true)
    expect(isCatalogPurchaseInbound({ ...order, sourceWarehouseCode: null, poId: 1n })).toBe(true)
  })
  it('rejects customer ASNs even when their line resembles a catalog SKU', () => {
    expect(isCatalogPurchaseInbound({ ...order, omsCustomerCode: 'TKL0001' })).toBe(false)
    expect(isCatalogPurchaseInbound({ ...order, items: [{ sku: 'TKL0001-719110' }] })).toBe(false)
    expect(isCatalogPurchaseInbound({ ...order, items: [{ sku: 'AFU0430-719110' }] })).toBe(false)
  })
  it('rejects missing procurement source, mixed ownership and empty lines', () => {
    expect(isCatalogPurchaseInbound({ ...order, sourceWarehouseCode: null })).toBe(false)
    expect(isCatalogPurchaseInbound({ ...order, items: [{ sku: 'TKL-719110' }, { sku: 'AFU0430-719110' }] })).toBe(false)
    expect(isCatalogPurchaseInbound({ ...order, items: [] })).toBe(false)
    expect(isCatalogPurchaseInbound({ ...order, items: [{ sku: ' ' }] })).toBe(false)
  })
})
