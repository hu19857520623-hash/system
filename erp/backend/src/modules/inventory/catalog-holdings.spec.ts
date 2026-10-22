import { fetchCatalogInventoryRows } from './oms-data-bridge.util'

describe('catalog holding availability and outbound locks', () => {
  const holding = (id: bigint, customerId: bigint, sku: string, quantity: number) => ({
    id, customerId, sku, quantity, productName: sku, unitPrice: 10, updatedAt: new Date(),
  })

  function fixture(rows: any[], locks: any[] = []) {
    const prisma = {
      customerSkuInventory: { findMany: jest.fn().mockResolvedValue(rows) },
      customer: { findMany: jest.fn().mockResolvedValue([
        { id: 1n, customerCode: 'TKL0001', customerName: '客户甲' },
        { id: 2n, customerCode: 'TKL0002', customerName: '客户乙' },
      ]) },
      outboundOrderItem: { findMany: jest.fn().mockResolvedValue(locks) },
      omsCatalogOrder: { findMany: jest.fn().mockResolvedValue([]) },
    }
    return prisma
  }

  it('hides inactive zero holdings without deleting their historical data', async () => {
    const prisma = fixture([holding(1n, 1n, 'SKU-1', 0), holding(2n, 1n, 'SKU-2', 12)])
    const rows = await fetchCatalogInventoryRows(prisma as any, {})
    expect(rows.map(r => r.sku)).toEqual(['SKU-2'])
    expect(rows[0]).toMatchObject({ availableQty: 12, lockedQty: 0 })
  })

  it('keeps zero available holdings with a real outbound reservation and resolves catalog SKU aliases', async () => {
    const prisma = fixture([holding(1n, 1n, 'SKU-1', 0)], [
      { sku: 'TKL-SKU-1', qty: 9, order: { customerId: 1n } },
    ])
    const rows = await fetchCatalogInventoryRows(prisma as any, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ availableQty: 0, lockedQty: 9, totalQty: 9, pendingOutboundQty: 9 })
    expect(prisma.outboundOrderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [expect.objectContaining({ order: {
        customerId: 1n, shippedAt: null, remark: { contains: '[stock:catalog]' },
        status: { in: ['pending_pick', 'picking', 'picked', 'reviewing', 'pending_relabel', 'packed', 'exception'] },
      } })] },
    }))
  })

  it('sums reservations per customer without deducting held availability twice', async () => {
    const prisma = fixture([holding(1n, 1n, 'SKU-1', 10), holding(2n, 2n, 'SKU-1', 7)], [
      { sku: 'SKU-1', qty: 3, order: { customerId: 1n } },
      { sku: 'SKU-1', qty: 2, order: { customerId: 1n } },
      { sku: 'SKU-1', qty: 4, order: { customerId: 2n } },
    ])
    const rows = await fetchCatalogInventoryRows(prisma as any, {})
    expect(rows[0]).toMatchObject({ customerCode: 'TKL0001', availableQty: 10, lockedQty: 5, totalQty: 15 })
    expect(rows[1]).toMatchObject({ customerCode: 'TKL0002', availableQty: 7, lockedQty: 4, totalQty: 11 })
  })

  it('stops displaying fully consumed holdings when no unshipped reservation remains', async () => {
    const prisma = fixture([holding(1n, 1n, 'SKU-1', 0)])
    expect(await fetchCatalogInventoryRows(prisma as any, {})).toEqual([])
    expect(prisma.omsCatalogOrder.findMany).not.toHaveBeenCalled()
  })
})
