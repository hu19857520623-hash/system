import { OutboundService } from './outbound.service'

function setup(status = 'cancelled') {
  const source = {
    id: 1n,
    outboundNo: 'OLD-1',
    customerId: 2n,
    warehouseCode: 'WMS-JHB-01',
    status,
    remark: '[stock:catalog] [oms_pre_deduct:{"preDeductTotal":25,"lines":[{"amount":25}]}] [oms_measure:{"cartons":[]}] [oms_actual_fees:{"lines":[]}] 用户备注',
    items: [{ productId: 3n, sku: 'SKU-1', qty: 2, needsRelabel: true, pickedQty: 2, locationCode: 'A-1' }],
    attachments: [{ fileType: 'skuLabel', fileName: 'sku.pdf', filePath: 'sku.pdf', unitIndex: 1 }, { fileType: 'pod' }],
  }
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    outboundOrder: {
      findUnique: jest.fn().mockResolvedValue(source),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ status: 1 }) },
    customer: {
      findUnique: jest.fn().mockResolvedValue({ status: 1, customerCode: 'TKL005' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventory: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    customerSkuInventory: {
      findMany: jest.fn().mockResolvedValue([{ id: 4n, quantity: 2 }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    operationLog: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  }
  const prisma = { $transaction: jest.fn().mockImplementation(callback => callback(tx)) }
  const billing = { recordOutboundCharges: jest.fn().mockResolvedValue([]) }
  const pushOutboundStatusToOms = jest.fn().mockResolvedValue(true)
  const service = Object.assign(Object.create(OutboundService.prototype), {
    prisma, billing, pushOutboundStatusToOms,
  }) as OutboundService
  return { service, tx, billing, pushOutboundStatusToOms }
}

describe('outbound reissue', () => {
  it('creates a new pending-pick order with source labels and fresh reservations', async () => {
    const { service, tx, billing, pushOutboundStatusToOms } = setup()
    const result = await service.reissue(1, 5)
    expect(result.alreadyReissued).toBe(false)
    expect(result.outboundNo).not.toBe('OLD-1')
    expect(tx.inventory.updateMany).toHaveBeenCalledWith({
      where: { productId: 3n, warehouseCode: 'WMS-JHB-01', availableQty: { gte: 2 } },
      data: { availableQty: { decrement: 2 }, lockedQty: { increment: 2 } },
    })
    expect(tx.customerSkuInventory.updateMany).toHaveBeenCalledWith({
      where: { id: 4n, quantity: { gte: 2 } }, data: { quantity: { decrement: 2 } },
    })
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 2n, status: 1, balance: { gte: 25 } }, data: { balance: { decrement: 25 } },
    })
    const { data } = tx.outboundOrder.create.mock.calls[0][0]
    expect(data).toMatchObject({ outboundNo: result.outboundNo, createdBy: 5n, status: 'pending_pick' })
    expect(data.items.create[0]).not.toHaveProperty('pickedQty')
    expect(data.attachments.create).toMatchObject([{ fileType: 'skuLabel', filePath: 'sku.pdf', unitIndex: 1 }])
    expect(data.remark).toContain('用户备注')
    expect(data.remark).not.toMatch(/oms_measure|oms_actual_fees/)
    expect(billing.recordOutboundCharges).toHaveBeenCalledWith(
      expect.objectContaining({ outboundNo: result.outboundNo }), tx,
    )
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetId: 'OLD-1', detail: { outboundNo: result.outboundNo } }),
    })
    expect(pushOutboundStatusToOms).toHaveBeenCalledWith(result.outboundNo)
  })

  it('returns the existing replacement on retry without reserving stock again', async () => {
    const { service, tx } = setup()
    tx.operationLog.findFirst.mockResolvedValue({ detail: { outboundNo: 'NEW-1' } })
    await expect(service.reissue(1, 5)).resolves.toEqual({ outboundNo: 'NEW-1', alreadyReissued: true })
    expect(tx.inventory.updateMany).not.toHaveBeenCalled()
    expect(tx.outboundOrder.create).not.toHaveBeenCalled()
  })

  it('rejects orders that are still active', async () => {
    const { service, tx } = setup('pending_pick')
    await expect(service.reissue(1, 5)).rejects.toThrow('仅已作废')
    expect(tx.inventory.updateMany).not.toHaveBeenCalled()
  })

  it.each(['库存', '余额'])('does not create a replacement when %s is insufficient', async shortage => {
    const { service, tx, pushOutboundStatusToOms } = setup()
    if (shortage === '库存') tx.inventory.updateMany.mockResolvedValue({ count: 0 })
    else tx.customer.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.reissue(1, 5)).rejects.toThrow(`${shortage}不足`)
    expect(tx.outboundOrder.create).not.toHaveBeenCalled()
    expect(tx.operationLog.create).not.toHaveBeenCalled()
    expect(pushOutboundStatusToOms).not.toHaveBeenCalled()
  })
})
