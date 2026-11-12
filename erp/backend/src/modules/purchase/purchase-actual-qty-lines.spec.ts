import { PurchaseService } from './purchase.service'

function setup() {
  const row: any = {
    id: 9n, poNo: 'PO-MULTI', prePoId: null, status: 'pending_actual_qty', warehouseCode: 'LW-TEST', totalAmount: 0,
    items: [
      { id: 11n, sku: 'SKU-A', productName: '商品A', plannedQty: 5, quantity: 0, unitPrice: 10, amount: 0, remark: null },
      { id: 12n, sku: 'SKU-B', productName: '商品B', plannedQty: 3, quantity: 0, unitPrice: 20, amount: 0, remark: null },
    ],
  }
  const tx: any = {
    sysUser: { findUnique: jest.fn().mockResolvedValue({ realName: '产品主管' }) },
    operationLog: { create: jest.fn().mockResolvedValue({ id: 1n }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrder: {
      findUnique: jest.fn(async () => ({ ...row, items: row.items.map((line: any) => ({ ...line })) })),
      update: jest.fn(async ({ data }: any) => {
        if (Array.isArray(data.items?.update)) {
          for (const entry of data.items.update) {
            const line = row.items.find((item: any) => item.id === entry.where.id)
            Object.assign(line, entry.data)
          }
        } else if (data.items?.update) {
          Object.assign(row.items[0], data.items.update.data)
        }
        const { items: _items, ...patch } = data
        Object.assign(row, patch)
        return { ...row, items: row.items.map((line: any) => ({ ...line })) }
      }),
    },
  }
  let queue = Promise.resolve()
  const prisma: any = { ...tx, $transaction: jest.fn((callback: any) => {
    const result = queue.then(() => callback(tx)); queue = result.catch(() => undefined); return result
  }) }
  const log = { log: jest.fn().mockResolvedValue({}) }
  const service = new PurchaseService(prisma, log as any)
  jest.spyOn(service as any, 'enrichOrders').mockImplementation(async (rows: any) => rows)
  return { row, tx, service }
}

describe('多明细采购单逐条核定实际数量', () => {
  it('逐条核定后金额合计、明细数量与审计一并提交', async () => {
    const { row, tx, service } = setup()
    const result = await service.setActualQty(9, {
      lines: [
        { itemId: 11, quantity: 4 },
        { itemId: 12, quantity: 3, remark: '按到样数量' },
      ],
    }, 1)
    expect(result.status).toBe('pending_po_audit')
    expect(row.totalAmount).toBe(100)
    expect(row.items[0]).toMatchObject({ quantity: 4, amount: 40 })
    expect(row.items[1]).toMatchObject({ quantity: 3, amount: 60, remark: '按到样数量' })
    expect(tx.purchaseOrder.update).toHaveBeenCalledTimes(1)
    expect(tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        module: 'purchase', action: 'set_actual_qty', targetId: 'PO-MULTI',
        detail: expect.objectContaining({
          totalAmount: 100,
          lines: [
            { sku: 'SKU-A', plannedQty: 5, actualQty: 4 },
            { sku: 'SKU-B', plannedQty: 3, actualQty: 3 },
          ],
        }),
      }),
    }))
  })

  it.each([0, -1, 1.5, 2147483648, NaN, '2'] as const)('任一行数量 %p 非法则整单拒绝且不写入', async (bad) => {
    const { row, tx, service } = setup()
    await expect(service.setActualQty(9, {
      lines: [{ itemId: 11, quantity: 2 }, { itemId: 12, quantity: bad as any }],
    })).rejects.toThrow('实际采购数量须为')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
    expect(row.items[0].quantity).toBe(0)
  })

  it('漏填、重复或未知明细均中文拒绝且不写入', async () => {
    const { tx, service } = setup()
    await expect(service.setActualQty(9, { lines: [{ itemId: 11, quantity: 2 }] }))
      .rejects.toThrow('请为每条采购明细填写实际采购数量')
    await expect(service.setActualQty(9, { lines: [{ itemId: 11, quantity: 2 }, { itemId: 11, quantity: 3 }, { itemId: 12, quantity: 1 }] }))
      .rejects.toThrow('同一条采购明细不能重复核定')
    await expect(service.setActualQty(9, { lines: [{ itemId: 11, quantity: 2 }, { itemId: 12, quantity: 1 }, { itemId: 99, quantity: 1 }] }))
      .rejects.toThrow('核定明细与采购单不一致')
    await expect(service.setActualQty(9, { lines: [] }))
      .rejects.toThrow('请为每条采购明细填写实际采购数量')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('单行金额或合计溢出都拒绝，不部分写入', async () => {
    const { row, tx, service } = setup()
    row.items[0].unitPrice = 9999999999
    await expect(service.setActualQty(9, {
      lines: [{ itemId: 11, quantity: 2147483647 }, { itemId: 12, quantity: 1 }],
    })).rejects.toThrow('金额超出')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('单明细采购单也支持统一逐条入口', async () => {
    const { row, tx, service } = setup()
    row.items = [row.items[0]]
    const result = await service.setActualQty(9, { lines: [{ itemId: 11, quantity: 5 }] }, 1)
    expect(result.status).toBe('pending_po_audit')
    expect(row.totalAmount).toBe(50)
    expect(tx.purchaseOrder.update).toHaveBeenCalledTimes(1)
  })

  it('并发逐条核定只有一方写入，后者被状态校验拒绝', async () => {
    const { row, tx, service } = setup()
    const payload = { lines: [{ itemId: 11, quantity: 2 }, { itemId: 12, quantity: 2 }] }
    const results = await Promise.allSettled([service.setActualQty(9, payload), service.setActualQty(9, payload)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(tx.purchaseOrder.update).toHaveBeenCalledTimes(1)
    expect(row.status).toBe('pending_po_audit')
  })
})
