import { PurchaseService } from './purchase.service'

function setup(status = 'pending_actual_qty') {
  const row: any = { id: 9n, poNo: 'PO-AUDIT', prePoId: 8n, status, warehouseCode: 'LW-TEST', items: [{ id: 11n, sku: 'AUDIT', plannedQty: 2, quantity: 0, unitPrice: 10 }] }
  const prePo: any = { id: 8n, convertedPoId: 9n, status: 'confirmed' }
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrder: {
      findUnique: jest.fn(async () => ({ ...row, items: row.items.map(line => ({ ...line })) })),
      update: jest.fn(async ({ data }) => {
        if (data.items?.update) Object.assign(row.items[0], data.items.update.data)
        const { items: _items, ...patch } = data
        Object.assign(row, patch)
        return { ...row, items: row.items.map(line => ({ ...line })) }
      }),
      delete: jest.fn(),
    },
    purchaseOrderItem: { deleteMany: jest.fn() },
    logisticsReceipt: { count: jest.fn().mockResolvedValue(0) },
    inboundOrder: { count: jest.fn().mockResolvedValue(0) },
    supplierFreightBill: { count: jest.fn().mockResolvedValue(0) },
    costLedger: { count: jest.fn().mockResolvedValue(0) },
    prePurchaseOrder: { findUnique: jest.fn(async () => ({ ...prePo })), update: jest.fn(async ({ data }) => Object.assign(prePo, data)) },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ warehouseType: 'logistics', status: 1 }) },
  }
  // Serializes callbacks just as the row lock serializes competing writers in MySQL.
  let queue = Promise.resolve()
  const prisma: any = { ...tx, $transaction: jest.fn(callback => {
    const result = queue.then(() => callback(tx)); queue = result.catch(() => undefined); return result
  }) }
  const log = { log: jest.fn().mockResolvedValue({}) }
  const service = new PurchaseService(prisma, log as any)
  jest.spyOn(service as any, 'enrichOrders').mockImplementation(async (rows: any) => rows)
  const effects = jest.spyOn(service as any, 'applyPostAuditEffects').mockResolvedValue(undefined)
  return { row, prePo, tx, service, effects, log }
}

describe('采购核定、审核和驳回继续', () => {
  it.each([0, -1, 1.5, 2147483648, Infinity, NaN])('拒绝无效数量 %s，且不写入', async quantity => {
    const { service, tx } = setup()
    await expect(service.setActualQty(9, { quantity })).rejects.toThrow('实际采购数量须为')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
  })
  it('并发核定只能一方成功，不能覆盖已进入审核的数量', async () => {
    const { service, tx, row } = setup()
    const results = await Promise.allSettled([service.setActualQty(9, { quantity: 2 }), service.setActualQty(9, { quantity: 3 })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(row.items[0].quantity).toBe(2)
    expect(row.totalAmount).toBe(20)
    expect(tx.purchaseOrder.update).toHaveBeenCalledTimes(1)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.purchaseOrder.findUnique.mock.invocationCallOrder[0])
  })
  it('多明细不静默只更新第一项，金额溢出也不入库', async () => {
    const { service, row, tx } = setup(); row.items.push({ ...row.items[0], id: 12n })
    await expect(service.setActualQty(9, { quantity: 2 })).rejects.toThrow('多项采购明细')
    row.items.pop(); row.items[0].unitPrice = 9999999999
    await expect(service.setActualQty(9, { quantity: 2147483647 })).rejects.toThrow('金额超出')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
  })
  it('已保存的仓库停用后也不能审核通过', async () => {
    const { service, tx, row, effects } = setup('pending_po_audit'); row.items[0].quantity = 2
    tx.warehouse.findUnique.mockResolvedValue({ warehouseType: 'logistics', status: 0 })
    await expect(service.approve(9)).rejects.toThrow('启用的物流中转仓')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled(); expect(effects).not.toHaveBeenCalled()
  })
  it('并发审核只执行一份主数据和成本副作用', async () => {
    const { service, row, effects } = setup('pending_po_audit'); row.items[0].quantity = 2
    const results = await Promise.allSettled([service.approve(9), service.approve(9)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(effects).toHaveBeenCalledTimes(1); expect(row.status).toBe('finance_approved')
  })
  it('驳回与审核竞争时，已驳回的单据不能再写入成本', async () => {
    const { service, prePo, row, effects } = setup('pending_po_audit'); row.items[0].quantity = 2
    const results = await Promise.allSettled([service.rejectPoAudit(9, 1, '请核对单价'), service.approve(9)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(row.status).toBe('rejected'); expect(row.poAuditRemark).toBe('请核对单价')
    expect(prePo.status).toBe('returned'); expect(effects).not.toHaveBeenCalled()
  })
  it('无原因或关联异常时不修改采购状态', async () => {
    const { service, prePo, tx } = setup('pending_po_audit')
    await expect(service.rejectPoAudit(9, 1, ' ')).rejects.toThrow('驳回原因')
    prePo.convertedPoId = 99n
    await expect(service.rejectPoAudit(9, 1, '请核对')).rejects.toThrow('关联预采购单状态异常')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled(); expect(tx.prePurchaseOrder.update).not.toHaveBeenCalled()
  })
  it('撤回打款标记清除旧已打款备注，重复操作不补写成本', async () => {
    const { service, row } = setup('finance_approved'); row.paymentStatus = 'paid'; row.financeRemark = '已打款'
    const costs = jest.spyOn(service as any, 'ensureCostRecordsForPo').mockResolvedValue({})
    await service.setPaymentStatus(9, false, 1)
    expect(row.paymentStatus).toBe('unpaid'); expect(row.financeRemark).toBe('已标记未打款'); expect(row.paidAt).toBeNull()
    await expect(service.setPaymentStatus(9, false, 1)).rejects.toThrow('已是未打款')
    expect(costs).toHaveBeenCalledTimes(1)
  })
  it('未审核单不能通过打款标记绕过审核写入成本', async () => {
    const { service, tx } = setup('pending_po_audit')
    const costs = jest.spyOn(service as any, 'ensureCostRecordsForPo').mockResolvedValue({})
    await expect(service.setPaymentStatus(9, true, 1)).rejects.toThrow('采购审核通过后')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled(); expect(costs).not.toHaveBeenCalled()
  })
  it('审核中的采购单不能当废弃单删除', async () => {
    const { service, tx } = setup('pending_po_audit')
    await expect(service.remove(9, 1)).rejects.toThrow('仅已驳回或草稿')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
  })
  it('已驳回且无收货费用的采购单可以删除，并取消关联预采购', async () => {
    const { service, prePo, tx, log } = setup('rejected')
    await service.remove(9, 1)
    expect(prePo.status).toBe('cancelled')
    expect(prePo.convertedPoId).toBeNull()
    expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalled()
    expect(tx.purchaseOrder.delete).toHaveBeenCalled()
    expect(log.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', targetId: 'PO-AUDIT' }))
  })
  it('已有收货记录的驳回单不能删除', async () => {
    const { service, tx } = setup('rejected')
    tx.logisticsReceipt.count.mockResolvedValue(1)
    await expect(service.remove(9, 1)).rejects.toThrow('不能删除')
    expect(tx.purchaseOrder.delete).not.toHaveBeenCalled()
  })
})
