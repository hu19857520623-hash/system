import { OutboundService } from './outbound.service'

describe('OMS outbound withdrawal', () => {
  function setup(status = 'pending_pick', transitioned = 1) {
    const order = {
      id: 1n, outboundNo: 'OUT-1', customerId: 2n, status, warehouseCode: 'WMS-JHB-01',
      remark: '[stock:catalog] [oms_pre_deduct:{"preDeductTotal":25,"lines":[{"type":"handling","amount":25}]}]',
      items: [{ productId: 3n, sku: 'SKU-1', productName: '商品', qty: 2 }], pickAllocations: [],
    }
    const tx = {
      inventory: {
        findUnique: jest.fn().mockResolvedValue({ id: 4n, availableQty: 8, lockedQty: 2 }),
        update: jest.fn().mockResolvedValue({}),
      },
      customerSkuInventory: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      customer: { update: jest.fn().mockResolvedValue({}) },
      outboundOrder: { updateMany: jest.fn().mockResolvedValue({ count: transitioned }) },
    }
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 2n }) },
      outboundOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 1n }),
        findUnique: jest.fn().mockResolvedValue(order),
      },
      $transaction: jest.fn().mockImplementation(callback => callback(tx)),
    }
    const service = Object.create(OutboundService.prototype) as OutboundService
    Object.assign(service, {
      prisma,
      detail: jest.fn().mockResolvedValue({ status: 'cancelled' }),
      pushOutboundStatusToOms: jest.fn().mockResolvedValue(undefined),
      pushOutboundRefundToOms: jest.fn().mockResolvedValue(undefined),
      getByOutboundNoForOms: jest.fn().mockResolvedValue({ outboundNo: 'OUT-1', omsStatus: 'cancelled' }),
    })
    return { service, prisma, tx, order }
  }

  it('withdraws pending pick and restores inventory and pre-deducted balance', async () => {
    const { service, prisma, tx } = setup()
    await expect(service.cancelFromOms('OUT-1', 'TKL005')).resolves.toMatchObject({ omsStatus: 'cancelled' })
    expect(prisma.outboundOrder.findFirst).toHaveBeenCalledWith({
      where: { outboundNo: 'OUT-1', customerId: 2n }, select: { id: true },
    })
    expect(tx.inventory.update).toHaveBeenCalledWith({ where: { id: 4n }, data: { availableQty: 10, lockedQty: 0 } })
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 2n }, data: { balance: { increment: 25 } } })
    expect(tx.outboundOrder.updateMany).toHaveBeenCalledWith({ where: { id: 1n, status: 'pending_pick' }, data: { status: 'cancelled' } })
  })

  it.each(['picking', 'picked', 'reviewing', 'pending_relabel', 'packed', 'shipped', 'cancelled', 'exception'])('blocks withdrawal in %s before changing inventory', async status => {
    const { service, prisma } = setup(status)
    await expect(service.cancelFromOms('OUT-1', 'TKL005')).rejects.toThrow('仅待拣货')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('does not withdraw another customer order', async () => {
    const { service, prisma } = setup()
    prisma.outboundOrder.findFirst.mockResolvedValue(null as any)
    await expect(service.cancelFromOms('OUT-1', 'OTHER')).rejects.toThrow('出库单不存在')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a status change during withdrawal so the transaction rolls back', async () => {
    const { service } = setup('pending_pick', 0)
    await expect(service.cancelFromOms('OUT-1', 'TKL005')).rejects.toThrow('取消操作已回滚')
    expect((service as any).pushOutboundRefundToOms).not.toHaveBeenCalled()
  })
})
