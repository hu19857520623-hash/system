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
    logisticsReceipt: { count: jest.fn().mockResolvedValue(0) },
    inboundOrder: { count: jest.fn().mockResolvedValue(0) },
    supplierFreightBill: { count: jest.fn().mockResolvedValue(0) },
    costLedger: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    purchaseOrderItem: { deleteMany: jest.fn(), delete: jest.fn(), update: jest.fn(), create: jest.fn() },
    prePurchaseOrder: { findUnique: jest.fn(async () => ({ ...prePo })), update: jest.fn(async ({ data }) => Object.assign(prePo, data)) },
    purchasePayment: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 4n }), create: jest.fn() },
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
  it('没有预采购的审核通过转入待分配，不写主数据和成本', async () => {
    const { service, row, tx, effects } = setup('pending_po_audit')
    row.prePoId = null
    row.supplierId = 2n
    row.items[0].quantity = 2
    row.items[0].sku = 'AUDIT'
    row.items[0].productName = '审核商品'
    tx.productDev = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => ({ id: 21n, applyNo: data.applyNo })) }
    tx.prePurchaseOrder.create = jest.fn(async ({ data }) => ({ id: 31n, ...data }))
    const result = await service.approve(9, 1, '通过')
    expect(effects).not.toHaveBeenCalled()
    expect(row.status).toBe('draft')
    expect(row.prePoId).toBe(31n)
    expect(tx.prePurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_assign', sku: 'AUDIT', convertedPoId: 9n }),
    }))
    expect(result.status).toBe('draft')
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
  it('定金和尾款分别记账，累计付清后才是已打款', async () => {
    const { service, row, tx } = setup('finance_approved')
    row.totalAmount = 100
    row.paymentStatus = 'unpaid'
    const payments: any[] = []
    tx.purchasePayment.findMany.mockImplementation(async () => payments.map((item) => ({ ...item })))
    tx.purchasePayment.create.mockImplementation(async ({ data }) => {
      const created = { id: payments.length + 1, ...data }
      payments.push(created)
      return created
    })
    jest.spyOn(service as any, 'ensureCostRecordsForPo').mockResolvedValue({})
    const deposit = await service.setPaymentStatus(9, true, 1, '先付定金', { paymentType: 'deposit', amount: 30 })
    expect(deposit.paymentStatus).toBe('partial')
    expect(deposit.financeRemark).toContain('定金 ¥30.00')
    const balance = await service.setPaymentStatus(9, true, 1, undefined, { paymentType: 'balance', amount: 70 })
    expect(balance.paymentStatus).toBe('paid')
    expect(tx.purchasePayment.create).toHaveBeenCalledTimes(2)
    await expect(service.setPaymentStatus(9, true, 1, undefined, { paymentType: 'full', amount: 1 })).rejects.toThrow('已付清')
  })
  it('审核通过且未付款收货的采购单可以撤回到待审核', async () => {
    const { service, row, tx } = setup('finance_approved')
    row.paymentStatus = 'unpaid'
    row.totalAmount = 20
    const result = await service.reopenAudit(9, 1, '数量要改')
    expect(result.status).toBe('pending_po_audit')
    expect(row.poAuditRemark).toBe('数量要改')
    expect(tx.costLedger.deleteMany).toHaveBeenCalledWith({ where: { referenceNo: 'PO-AUDIT' } })
  })
  it('已登记付款的采购单不能撤回审核', async () => {
    const { service, tx } = setup('finance_approved')
    tx.purchasePayment.count.mockResolvedValue(1)
    await expect(service.reopenAudit(9, 1)).rejects.toThrow('已登记付款')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled()
  })
  it('撤回后的待审核采购单可以修改数量和单价', async () => {
    const { service, row, tx } = setup('pending_po_audit')
    row.items[0].quantity = 2
    row.totalAmount = 20
    tx.purchaseOrderItem.update.mockImplementation(async ({ data }) => Object.assign(row.items[0], data))
    const result = await service.revisePendingAudit(9, {
      supplierName: '示例供应商',
      warehouseCode: 'LW-TEST',
      items: [{ id: 11, sku: 'AUDIT', productName: '审核商品', quantity: 5, unitPrice: 12 }],
    }, 1)
    expect(result.status).toBe('pending_po_audit')
    expect(row.totalAmount).toBe(60)
    expect(tx.purchaseOrderItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 5, unitPrice: 12, amount: 60 }),
    }))
  })
  it('未审核单不能通过打款标记绕过审核写入成本', async () => {
    const { service, tx } = setup('pending_po_audit')
    const costs = jest.spyOn(service as any, 'ensureCostRecordsForPo').mockResolvedValue({})
    await expect(service.setPaymentStatus(9, true, 1)).rejects.toThrow('采购审核通过后')
    expect(tx.purchaseOrder.update).not.toHaveBeenCalled(); expect(costs).not.toHaveBeenCalled()
  })
  it('审核中的采购单不能标为废订单', async () => {
    const { service, row } = setup('pending_po_audit')
    await expect(service.voidOrder(9, 1)).rejects.toThrow('仅已驳回或草稿')
    expect(row.status).toBe('pending_po_audit')
  })
  it('已驳回且无收货费用的采购单标为废订单，并取消关联预采购', async () => {
    const { service, row, prePo, tx, log } = setup('rejected')
    const result = await service.voidOrder(9, 1)
    expect(row.status).toBe('voided')
    expect(result.status).toBe('voided')
    expect(prePo.status).toBe('cancelled')
    expect(prePo.convertedPoId).toBeNull()
    expect(tx.purchaseOrder.delete).not.toHaveBeenCalled()
    expect(log.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'void', targetId: 'PO-AUDIT' }))
  })
  it('已有收货记录的驳回单不能标为废订单', async () => {
    const { service, row, tx } = setup('rejected')
    tx.logisticsReceipt.count.mockResolvedValue(1)
    await expect(service.voidOrder(9, 1)).rejects.toThrow('不能标为废订单')
    expect(row.status).toBe('rejected')
    expect(tx.purchaseOrder.delete).not.toHaveBeenCalled()
  })
})
