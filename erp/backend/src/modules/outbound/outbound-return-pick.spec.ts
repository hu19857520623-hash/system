import { OutboundService } from './outbound.service'

function setup(status = 'picked') {
  const allocation = { status: 'picked', productId: 2n, sku: 'SKU', warehouseCode: 'YW', locationId: 3n, inventoryLocationId: 4n, locationCode: 'A01', qty: 5 }
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    outboundOrder: { findUnique: jest.fn().mockResolvedValue({ id: 1n, outboundNo: 'OB1', status, pickerId: 9n, pickAllocations: [allocation] }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    outboundPickAllocation: { updateMany: jest.fn() }, outboundOrderItem: { updateMany: jest.fn() }, operationLog: { create: jest.fn() },
  }
  const mutation = { restoreLocationQty: jest.fn() }
  const service = new OutboundService({ $transaction: (fn: any) => fn(tx) } as any, {} as any, {} as any, {} as any, {} as any, {} as any)
  ;(service as any).inventoryMutation = mutation
  jest.spyOn(service as any, 'pushOutboundStatusToOms').mockResolvedValue(undefined)
  jest.spyOn(service, 'detail').mockResolvedValue({ status: 'pending_pick' } as any)
  return { service, tx, mutation }
}

describe('已拣货返回待拣货', () => {
  it('回补原库位并清空拣货资料', async () => {
    const { service, tx, mutation } = setup()
    await expect(service.returnToPendingPick(1, 8)).resolves.toEqual({ status: 'pending_pick' })
    expect(mutation.restoreLocationQty).toHaveBeenCalledWith(tx, expect.objectContaining({ inventoryLocationId: 4n, qty: 5 }))
    expect(tx.outboundOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1n, status: 'picked' }, data: expect.objectContaining({ status: 'pending_pick', pickerId: null, pickedAt: null }) }))
    expect(tx.outboundOrderItem.updateMany).toHaveBeenCalledWith({ where: { outboundId: 1n }, data: { pickedQty: 0, locationCode: null } })
    expect(tx.operationLog.create).toHaveBeenCalled()
  })
  it.each(['pending_pick', 'picking', 'reviewing', 'packed', 'shipped', 'cancelled'])('拒绝 %s 状态，避免重复回补', async status => {
    const { service, mutation } = setup(status)
    await expect(service.returnToPendingPick(1, 8)).rejects.toThrow('仅已拣货')
    expect(mutation.restoreLocationQty).not.toHaveBeenCalled()
  })
  it('状态竞争失败时不回补库存', async () => {
    const { service, tx, mutation } = setup()
    tx.outboundOrder.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.returnToPendingPick(1, 8)).rejects.toThrow('状态已变化')
    expect(mutation.restoreLocationQty).not.toHaveBeenCalled()
  })
})
