import { InventoryService } from './inventory.service'
import { fetchOmsInventoryRows, fetchOmsProductRows } from './oms-data-bridge.util'

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
    const result = await service.query({ dataSource: 'catalog_holdings', page: 251, pageSize: 20 } as any)
    expect(result.total).toBe(5001)
    expect(result.items.map((row: any) => row.sku)).toEqual(['H-05000'])
    expect(prisma.customerSkuInventory.findMany.mock.calls[0][0]).not.toHaveProperty('take')
  })

  it('exports every holding instead of stopping at 5000', async () => {
    const { service } = serviceWith(holdings(5001))
    const result = await service.query({ dataSource: 'catalog_holdings' } as any, true)
    expect(result.total).toBe(5001)
    expect(result.items).toHaveLength(5001)
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
