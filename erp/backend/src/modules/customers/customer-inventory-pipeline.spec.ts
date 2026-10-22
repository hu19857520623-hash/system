import { CustomersService } from './customers.service'

describe('客户库存同步的在途和待上架数量', () => {
  function fixture(statuses: string[], stocked = false) {
    const prisma = {
      inboundOrder: { findMany: jest.fn().mockResolvedValue(statuses.map(status => ({
        warehouseCode: 'WMS-JHB-01', status,
        items: [{ productId: 7n, sku: 'TKL9001-A', expectedQty: 3, actualQty: status === 'pending_putaway' ? 3 : null, putawayQty: status === 'pending_putaway' ? 1 : 0 }],
      }))) },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 7n, sku: 'TKL9001-A', productName: '测试商品' }]) },
      inventory: { findMany: jest.fn().mockResolvedValue(stocked ? [{ productId: 7n, availableQty: 2, lockedQty: 0, totalQty: 2 }] : []) },
    }
    const service = new CustomersService(prisma as any, null as any)
    jest.spyOn(service, 'findByCodeForOms').mockResolvedValue({ id: 1, customerCode: 'TKL9001', customerName: '测试客户' } as any)
    jest.spyOn(service as any, 'listSkuInventory').mockResolvedValue([])
    return { prisma, service }
  }

  it('只有在途、尚未首次入库的商品也进入客户库存视图，可用量保持零', async () => {
    const { prisma, service } = fixture(['pending_receipt'])
    const result = await service.inventoryViewForOms('TKL9001')
    expect(result.items).toEqual([expect.objectContaining({ stockSource: 'owned', warehouseAvailable: 0, warehouseTotal: 0, inTransitQty: 3, pendingShelvingQty: 0 })])
    const where = prisma.inboundOrder.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ omsCustomerCode: 'TKL9001', warehouseCode: 'WMS-JHB-01' })
    expect(where.status.in).not.toEqual(expect.arrayContaining(['draft', 'oms_draft', 'cancelled']))
  })

  it('同SKU已入库、在途及部分上架合并成一条记录，三个数量分开计算', async () => {
    const { service } = fixture(['completed', 'pending_receipt', 'pending_putaway'], true)
    const result = await service.inventoryViewForOms('TKL9001')
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({ warehouseAvailable: 2, warehouseTotal: 2, inTransitQty: 3, pendingShelvingQty: 2 })
  })
})
