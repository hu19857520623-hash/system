import { reduceInboundQuantity, reductionTarget } from './inbound-reduce.util'

describe('PDA quantity reduction', () => {
  const fixture = (status = 'receiving') => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      inboundOrder: { findUnique: jest.fn().mockResolvedValue({ id: 61n, inboundNo: 'RVTEST', status, warehouseCode: 'W', receivedCartonCount: 3 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inboundOrderItem: { findFirst: jest.fn().mockResolvedValue({ id: 1n, inboundId: 61n, sku: 'TKL005-ABC', productId: 2n, actualQty: 16, expectedQty: 16, putawayQty: 5 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inboundCarton: { findMany: jest.fn().mockResolvedValue([1n, 2n, 3n].map((id) => ({ id, boxCode: `BOX-${id}` }))), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inboundPutawayItem: { findFirst: jest.fn().mockResolvedValue({ id: 9n, qty: 3, locationId: 10n, locationCode: 'R01' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      operationLog: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    }
    const prisma: any = { $transaction: (fn: any) => fn(tx) }
    const inventory: any = { undoPutawayStock: jest.fn().mockResolvedValue(undefined) }
    return { tx, prisma, inventory }
  }
  const body = { inboundItemId: 1, quantity: 2, expectedCurrent: 16, reason: '重复扫码', clientRequestId: 'request-1' }

  it('never allows negative or fractional remaining counts', () => {
    expect(reductionTarget(16, 2, 16)).toBe(14)
    expect(reductionTarget(2, 2, 2)).toBe(0)
    for (const qty of [0, -1, 1.5, 17, NaN]) expect(() => reductionTarget(16, qty, 16)).toThrow()
    expect(() => reductionTarget(17, 2, 16)).toThrow('已发生变化')
  })
  it('reduces actual quantity without changing expected or advancing status', async () => {
    const f = fixture()
    const result: any = await reduceInboundQuantity(f.prisma, f.inventory, 61, 'qc', body, 18)
    expect(result.after).toBe(14)
    expect(f.tx.inboundOrderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { actualQty: 14, diffQty: -2 } }))
    expect(f.tx.inboundOrder.updateMany).not.toHaveBeenCalled()
    expect(f.tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ detail: expect.objectContaining({ before: 16, after: 14, clientRequestId: 'request-1' }) }) }))
  })
  it('does not repeat a request after a timeout', async () => {
    const f = fixture()
    f.tx.operationLog.findFirst.mockResolvedValue({ id: 4n })
    const result: any = await reduceInboundQuantity(f.prisma, f.inventory, 61, 'qc', body)
    expect(result.duplicate).toBe(true)
    expect(f.tx.inboundOrderItem.updateMany).not.toHaveBeenCalled()
  })
  it('blocks completed receipts and stale counts', async () => {
    const f = fixture('completed')
    await expect(reduceInboundQuantity(f.prisma, f.inventory, 61, 'qc', body)).rejects.toThrow('后续环节')
    expect(f.tx.inboundOrderItem.updateMany).not.toHaveBeenCalled()
    const g = fixture()
    await expect(reduceInboundQuantity(g.prisma, g.inventory, 61, 'qc', { ...body, expectedCurrent: 15 })).rejects.toThrow('已发生变化')
  })
  it('rejects unknown item ids and reduction below putaway quantity', async () => {
    const f = fixture()
    f.tx.inboundOrderItem.findFirst.mockResolvedValue(null)
    await expect(reduceInboundQuantity(f.prisma, f.inventory, 61, 'qc', body)).rejects.toThrow('不属于')
    const g = fixture()
    await expect(reduceInboundQuantity(g.prisma, g.inventory, 61, 'qc', { ...body, quantity: 12 })).rejects.toThrow('已上架')
  })
  it('unconfirms the last carton and allows reducing to zero', async () => {
    const f = fixture()
    await reduceInboundQuantity(f.prisma, f.inventory, 61, 'carton', { ...body, expectedCurrent: 3, quantity: 1 })
    expect(f.tx.inboundCarton.updateMany).toHaveBeenCalledTimes(1)
    expect(f.tx.inboundOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { receivedCartonCount: 2 } }))
  })
  it('withdraws only the most recent putaway lot and preserves actual quantity', async () => {
    const f = fixture('pending_putaway')
    await reduceInboundQuantity(f.prisma, f.inventory, 61, 'putaway', { ...body, expectedCurrent: 5 })
    expect(f.inventory.undoPutawayStock).toHaveBeenCalledWith(f.tx, expect.objectContaining({ inboundNo: 'RVTEST', locationId: 10n, qty: 2 }))
    expect(f.tx.inboundOrderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { putawayQty: 3 } }))
    const g = fixture('pending_putaway')
    await expect(reduceInboundQuantity(g.prisma, g.inventory, 61, 'putaway', { ...body, expectedCurrent: 5, quantity: 4 })).rejects.toThrow('最多可撤回 3')
  })
  it('never changes putaway records if stock has already been used', async () => {
    const f = fixture('pending_putaway')
    f.inventory.undoPutawayStock.mockRejectedValue(new Error('库存已锁定'))
    await expect(reduceInboundQuantity(f.prisma, f.inventory, 61, 'putaway', { ...body, expectedCurrent: 5 })).rejects.toThrow('库存已锁定')
    expect(f.tx.inboundPutawayItem.updateMany).not.toHaveBeenCalled()
  })
})
