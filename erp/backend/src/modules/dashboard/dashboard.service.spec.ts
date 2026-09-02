import { DashboardService } from './dashboard.service'

function createPrismaMock() {
  return {
    product: { count: jest.fn() },
    supplier: { count: jest.fn() },
    lead: { count: jest.fn() },
    purchaseOrder: { count: jest.fn(), findMany: jest.fn() },
    productDev: { count: jest.fn() },
    syncLog: { count: jest.fn() },
    inventory: { aggregate: jest.fn() },
    announcement: { findMany: jest.fn() },
    inboundOrder: { count: jest.fn() },
    outboundOrder: { count: jest.fn() },
    productPricing: { count: jest.fn() },
    mingruiShipment: { count: jest.fn() },
    logisticsReceipt: { count: jest.fn() },
    logisticsReceiptItem: { aggregate: jest.fn() },
  }
}

describe('DashboardService', () => {
  let prisma: ReturnType<typeof createPrismaMock>
  let announcementService: { listVisibleForErp: jest.Mock }
  let permissions: { getUserPermissions: jest.Mock }
  let service: DashboardService

  beforeEach(() => {
    prisma = createPrismaMock()
    announcementService = { listVisibleForErp: jest.fn() }
    permissions = { getUserPermissions: jest.fn().mockResolvedValue(Object.values({
      inventoryAvailable: 'dashboard.kpi_inventory',
      products: 'dashboard.kpi_products',
      suppliers: 'dashboard.kpi_suppliers',
      leads: 'dashboard.kpi_leads',
      pendingPo: 'dashboard.kpi_purchase',
      pendingAudit: 'dashboard.kpi_audit',
      syncFailed: 'dashboard.kpi_sync',
    })) }
    service = new DashboardService(prisma as any, announcementService as any, permissions as any)
  })

  it('stats aggregates KPI counts and available inventory for admin', async () => {
    prisma.product.count.mockResolvedValue(10)
    prisma.supplier.count.mockResolvedValue(4)
    prisma.lead.count.mockResolvedValue(8)
    prisma.purchaseOrder.count.mockResolvedValue(2)
    prisma.productDev.count.mockResolvedValue(3)
    prisma.syncLog.count.mockResolvedValue(1)
    prisma.inventory.aggregate.mockResolvedValue({ _sum: { availableQty: 120 } })

    await expect(service.stats(1, 'admin')).resolves.toEqual({
      products: 10,
      suppliers: 4,
      leads: 8,
      pendingPo: 2,
      pendingAudit: 3,
      syncFailed: 1,
      inventoryAvailable: 120,
    })
    expect(prisma.supplier.count).toHaveBeenCalledWith({ where: { status: 1 } })
  })

  it('stats filters KPI fields by role permissions', async () => {
    permissions.getUserPermissions.mockResolvedValue(['dashboard.kpi_leads'])
    prisma.product.count.mockResolvedValue(10)
    prisma.supplier.count.mockResolvedValue(4)
    prisma.lead.count.mockResolvedValue(8)
    prisma.purchaseOrder.count.mockResolvedValue(2)
    prisma.productDev.count.mockResolvedValue(3)
    prisma.syncLog.count.mockResolvedValue(1)
    prisma.inventory.aggregate.mockResolvedValue({ _sum: { availableQty: 120 } })

    await expect(service.stats(2, 'cs')).resolves.toEqual({ leads: 8 })
  })

  it('stats falls back to 0 when inventory sum is null', async () => {
    prisma.product.count.mockResolvedValue(0)
    prisma.supplier.count.mockResolvedValue(0)
    prisma.lead.count.mockResolvedValue(0)
    prisma.purchaseOrder.count.mockResolvedValue(0)
    prisma.productDev.count.mockResolvedValue(0)
    prisma.syncLog.count.mockResolvedValue(0)
    prisma.inventory.aggregate.mockResolvedValue({ _sum: { availableQty: null } })

    await expect(service.stats(1, 'admin')).resolves.toMatchObject({ inventoryAvailable: 0 })
  })

  it('announcements returns visible ERP channel rows', async () => {
    const rows = [{ id: 1, title: '盘点' }]
    announcementService.listVisibleForErp.mockResolvedValue(rows)

    await expect(service.announcements()).resolves.toBe(rows)
    expect(announcementService.listVisibleForErp).toHaveBeenCalledWith(10)
  })

  it('trends clamps days and returns daily logistics receipt series', async () => {
    prisma.logisticsReceipt.count.mockResolvedValue(2)
    prisma.logisticsReceiptItem.aggregate.mockResolvedValue({
      _sum: { actualQty: 15, damagedQty: 1 },
    })

    const result = await service.trends(99, 1, 'admin')
    expect(result.days).toBe(30)
    expect(result.series).toHaveLength(30)
    expect(result.series[0]).toEqual(
      expect.objectContaining({
        date: expect.stringMatching(/^\d{2}-\d{2}$/),
        receipts: 2,
        receivedQty: 15,
        damagedQty: 1,
      }),
    )
  })

  it('trends rejects invalid days by clamping to at least 1', async () => {
    prisma.logisticsReceipt.count.mockResolvedValue(0)
    prisma.logisticsReceiptItem.aggregate.mockResolvedValue({
      _sum: { actualQty: null, damagedQty: null },
    })

    const result = await service.trends(0, 1, 'admin')
    expect(result.days).toBe(1)
    expect(result.series).toHaveLength(1)
    expect(result.series[0]).toEqual(
      expect.objectContaining({ receipts: 0, receivedQty: 0, damagedQty: 0 }),
    )
  })

  it('trends returns empty when user lacks permission', async () => {
    permissions.getUserPermissions.mockResolvedValue(['dashboard.kpi_leads'])
    const result = await service.trends(7, 2, 'cs')
    expect(result).toEqual({ days: 0, series: [] })
    expect(prisma.logisticsReceipt.count).not.toHaveBeenCalled()
  })

  it('notifications builds badges and conditional exception items', async () => {
    prisma.lead.count.mockResolvedValue(1)
    prisma.productDev.count.mockResolvedValue(0)
    prisma.purchaseOrder.count.mockResolvedValue(2)
    prisma.purchaseOrder.findMany.mockResolvedValue([
      { items: [{ quantity: 10, receivedQty: 3 }] },
      { items: [{ quantity: 5, receivedQty: 5 }] },
    ])
    prisma.inboundOrder.count
      .mockResolvedValueOnce(0) // in transit
      .mockResolvedValueOnce(1) // arrived
      .mockResolvedValueOnce(0) // receiving
      .mockResolvedValueOnce(0) // putaway
      .mockResolvedValueOnce(4) // exception
    prisma.outboundOrder.count.mockResolvedValue(0)
    prisma.productPricing.count.mockResolvedValue(0)
    prisma.syncLog.count.mockResolvedValue(0)
    prisma.mingruiShipment.count.mockResolvedValue(0)

    const result = await service.notifications()
    expect(result.badges.logistics_wh).toBe(1)
    expect(result.badges.inbound_arrived).toBe(1)
    expect(result.badges.inbound_receipt).toBe(1)
    expect(result.badges.inbound_exception).toBe(4)
    expect(result.items.some((item) => item.key === 'inbound_exception')).toBe(true)
    expect(result.total).toBeGreaterThan(0)
  })
})
