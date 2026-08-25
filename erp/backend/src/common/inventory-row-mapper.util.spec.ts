import { buildErpWarehouseInventoryRow, resolveCustomerIdentity } from './inventory-row-mapper.util'

describe('inventory customer identity', () => {
  it('does not treat an arbitrary SKU prefix as a customer code', () => {
    const identity = resolveCustomerIdentity({
      sku: 'E2E-20260811-1732',
      fallbackSupplierCode: 'SUP-SZ-001',
      fallbackSupplierName: '深圳优品电子',
      customerNameByCode: new Map([['TKL0001', '真实客户']]),
    })
    expect(identity).toEqual({ customerCode: '', customerSku: 'E2E-20260811-1732', customerName: '' })
  })

  it('accepts a SKU prefix only when it maps to a real customer', () => {
    const identity = resolveCustomerIdentity({
      sku: 'TKL0001-CABLE-01',
      customerNameByCode: new Map([['TKL0001', '真实客户']]),
    })
    expect(identity).toEqual({
      customerCode: 'TKL0001',
      customerSku: 'CABLE-01',
      customerName: '真实客户',
    })
  })

  it('maps catalog pool internal SKU to platform customer TKL', () => {
    const identity = resolveCustomerIdentity({
      sku: 'TKL-TK-99001',
      customerNameByCode: new Map([['TKL', '平台货盘']]),
    })
    expect(identity).toEqual({
      customerCode: 'TKL',
      customerSku: 'TK-99001',
      customerName: '平台货盘',
    })
  })

  it('keeps supplier and customer labels separate in ERP inventory rows', () => {
    const row = buildErpWarehouseInventoryRow({
      id: 1,
      sku: 'E2E-20260811-1732',
      productId: 1,
      productName: '审计商品',
      spec: '',
      category: '',
      spu: '',
      barcode: '',
      rawWarehouseCode: 'LW-SZ-01',
      warehouseName: '深圳物流仓',
      available: 8,
      locked: 0,
      inTransit: 0,
      pendingPutaway: 0,
      fallbackSupplierCode: 'SUP-SZ-001',
      fallbackSupplierName: '深圳优品电子',
      customerNameByCode: new Map(),
    })
    expect(row.customerCode).toBe('')
    expect(row.customerName).toBe('')
    expect(row.supplierName).toBe('深圳优品电子')
  })
})
