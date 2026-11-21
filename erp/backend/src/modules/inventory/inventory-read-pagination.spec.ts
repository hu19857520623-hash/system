import { InventoryService } from './inventory.service'
import { fetchOmsInventoryRows, fetchOmsProductRows } from './oms-data-bridge.util'
import { inventoryOwnerKey } from './inventory-source.util'

function holdings(count: number) {
  const stamp = new Date('2026-11-11T00:00:00Z')
  return Array.from({ length: count }, (_, i) => ({
    id: BigInt(i + 1),
    customerId: 7n,
    sku: `H-${String(i).padStart(5, '0')}`,
    productName: '隔离库存',
    quantity: 1,
    unitPrice: 1,
    updatedAt: stamp,
  }))
}

function serviceWith(rows: any[]) {
  const prisma = {
    warehouse: { findMany: jest.fn().mockResolvedValue([]) },
    customerSkuInventory: { findMany: jest.fn().mockResolvedValue(rows) },
    customer: { findMany: jest.fn().mockResolvedValue([{ id: 7n, customerCode: 'TKL0007', customerName: '隔离客户' }]) },
    outboundOrderItem: { findMany: jest.fn().mockResolvedValue([]) },
    omsCatalogOrder: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const service = new InventoryService(prisma as any, {} as any, {} as any)
  jest.spyOn(service as any, 'loadInboundReceivedMeta').mockResolvedValue({
    productIds: [], productIdSet: new Set(), bySkuWh: new Map(),
  })
  return { service, prisma }
}

describe('inventory reads past 5000 rows', () => {
  it('returns the holding after row 5000 and the complete total', async () => {
    const { service, prisma } = serviceWith(holdings(5001))
    const result = await service.queryCatalogHoldings({ page: 251, pageSize: 20 })
    expect(result.total).toBe(5001)
    expect(result.items.map((row: any) => row.sku)).toEqual(['H-05000'])
    expect(prisma.customerSkuInventory.findMany.mock.calls[0][0]).not.toHaveProperty('take')
  })

  it('rejects purchaser holdings in inventory queries and inventory exports', async () => {
    const { service, prisma } = serviceWith(holdings(1))
    await expect(service.query({ dataSource: 'catalog_holdings' })).rejects.toThrow('货盘持有')
    await expect(service.query({ dataSource: 'catalog_holdings' }, true)).rejects.toThrow('货盘持有')
    expect(prisma.customerSkuInventory.findMany).not.toHaveBeenCalled()
  })

  it('keeps platform stock and original OMS stock in the two owner views', async () => {
    const catalog = { id: 1n, sku: 'TK-LEGACY', remark: null }
    const customer = { id: 2n, sku: 'TKL0007-OWN', remark: null }
    const warehouse = { warehouseCode: 'WMS-JHB-01' }
    const stock = [catalog, customer].map((product) => ({
      ...warehouse, id: product.id, productId: product.id, sku: product.sku, availableQty: 3, lockedQty: 0, totalQty: 3,
    }))
    const { service, prisma } = serviceWith(holdings(1))
    const client = Object.assign(prisma, {
      product: { findMany: jest.fn().mockResolvedValue([catalog, customer]) },
      productPricing: { findMany: jest.fn().mockResolvedValue([]) },
      inventory: { findMany: jest.fn().mockResolvedValue(stock) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { id: 'owned', sku: customer.sku, customerCode: 'TKL0007', stockSource: 'own', warehouse: 'jhb1' },
        { id: 'borrowed', sku: 'TKL-TK-LEGACY', customerCode: 'TKL0007', stockSource: 'catalog', warehouse: 'jhb1' },
      ]),
    })
    prisma.warehouse.findMany.mockResolvedValue([warehouse])
    jest.spyOn(service as any, 'loadPipelineQtyMap').mockResolvedValue(new Map())

    const catalogResult = await service.query({ dataSource: 'erp', includeSourceCounts: 'true' })
    const customerResult = await service.query({ dataSource: 'oms', customerKeyword: 'TKL0007' })
    expect(catalogResult).toMatchObject({
      items: [{ sku: catalog.sku, customerCode: 'TKL', customerSku: 'TK-LEGACY' }],
      sourceCounts: { all: 2, erp: 1, oms: 1 },
    })
    expect(customerResult.items).toMatchObject([{ sku: customer.sku, customerCode: 'TKL0007', customerSku: 'OWN', dataSource: 'erp' }])
    expect(client.$queryRawUnsafe.mock.calls[0][0]).toContain("i.stockSource <> 'catalog'")
    expect(prisma.customerSkuInventory.findMany).not.toHaveBeenCalled()
  })

  it('reads every OMS inventory row and reports a Chinese failure', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ id: i + 1, sku: `O-${i}`, name: 'OMS', available: 1, warehouse: 'jhb1' }))
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) }
    const result = await fetchOmsInventoryRows(prisma as any, { productCode: 'O-' })
    expect(result).toHaveLength(5001)
    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).not.toMatch(/LIMIT 5000/)
    prisma.$queryRawUnsafe.mockRejectedValue(Error('SQL connection lost') as never)
    await expect(fetchOmsInventoryRows(prisma as any, {})).rejects.toThrow('无法读取 OMS 库存，请稍后重试')
  })

  it('keeps customer inbound quantities separate from the catalog pool for the same SKU', async () => {
    const sku = 'FUR-LVR-SID-011'
    const warehouseCode = 'WMS-JHB-01'
    const order = { warehouseCode, status: 'pending_receipt' }
    const prisma = { inboundOrder: { findMany: jest.fn().mockResolvedValue([
      { ...order, omsCustomerCode: 'TKL0444', stockSource: 'owned', items: [{ sku, expectedQty: 40 }] },
      { ...order, omsCustomerCode: null, stockSource: 'catalog', items: [{ sku, expectedQty: 10 }] },
    ]) } }
    const service = new InventoryService(prisma as any, {} as any, {} as any)
    const result = await (service as any).loadPipelineQtyMap([warehouseCode])
    expect(result.get(inventoryOwnerKey('TKL', sku, warehouseCode))).toMatchObject({ inTransit: 10 })
    expect(result.get(inventoryOwnerKey('TKL0444', sku, warehouseCode))).toMatchObject({ inTransit: 40 })
  })

  it('reads every OMS product and reports a Chinese failure', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ id: i + 1, internalSku: `P-${i}`, name: '商品', productStatus: 'active' }))
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) }
    const result = await fetchOmsProductRows(prisma as any, {})
    expect(result).toHaveLength(5001)
    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).not.toMatch(/LIMIT 5000/)
    prisma.$queryRawUnsafe.mockRejectedValue(Error('SQL connection lost') as never)
    await expect(fetchOmsProductRows(prisma as any, {})).rejects.toThrow('无法读取 OMS 商品，请稍后重试')
  })
})
