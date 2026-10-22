import { PrePurchaseService } from './pre-purchase.service'

function setup() {
  const row: any = { id: 8n, devId: 12n, sku: 'AUDIT-PD', prePoNo: 'PRE-AUDIT-PD', status: 'assigned', purchaserId: 1n, supplierId: 2n, plannedQty: 2, unitPrice: 10, spec: '虚构规格', productName: '虚构商品', productVolumeCbm: 0.001, packageVolumeCbm: 0.002 }
  let po: any = null
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    prePurchaseOrder: { findUnique: jest.fn(async () => ({ ...row })), update: jest.fn(async ({ data }) => { Object.assign(row, data); return { ...row } }) },
    supplier: { findUnique: jest.fn().mockResolvedValue({ id: 2n, status: 1 }), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 3n }) },
    purchaseOrder: { create: jest.fn(async ({ data }) => { po = { ...data, id: 9n }; return po }), findUnique: jest.fn(async () => po) },
    product: { findFirst: jest.fn().mockResolvedValue(null) }, productDev: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
  }
  const prisma = { ...tx, $transaction: jest.fn(async callback => callback(tx)) }
  const log = { log: jest.fn().mockResolvedValue({}) }
  const service = new PrePurchaseService(prisma as any, log as any)
  return { service, row, tx, log }
}

describe('预采购确认与所属采购员', () => {
  it('未分配给当前采购员的确认请求被拒绝且不建单', async () => {
    const { service, tx } = setup()
    await expect(service.confirm(8, { userId: 7, roleCode: 'purchaser' })).rejects.toThrow('无权确认未分配给您的预采购单')
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled()
  })
  it('确认先锁定单据，再读取状态；重复调用返回原单据且只记一次转换日志', async () => {
    const { service, tx, log } = setup()
    const first = await service.confirm(8, { userId: 1, roleCode: 'purchaser' })
    const replay = await service.confirm(8, { userId: 1, roleCode: 'purchaser' })
    expect(first.poId).toBe(replay.poId)
    expect(replay.duplicate).toBe(true)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.prePurchaseOrder.findUnique.mock.invocationCallOrder[0])
    expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(1)
    expect(log.log).toHaveBeenCalledTimes(1)
  })
  it('已取消记录不能确认，也不生成采购单', async () => {
    const { service, row, tx } = setup(); row.status = 'cancelled'
    await expect(service.confirm(8, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('仅已分配的预采购单可确认')
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled()
  })
  it('编辑权限同样限制在本人分配，拒绝发生在供应商修改之前', async () => {
    const { service, tx } = setup()
    await expect(service.update(8, { supplierName: '不应创建' }, { userId: 7, roleCode: 'purchaser' })).rejects.toThrow('无权编辑')
    expect(tx.supplier.create).not.toHaveBeenCalled()
  })
  it('缺一项尺寸时先中文拒绝，不创建手填供应商', async () => {
    const { service, tx } = setup()
    await expect(service.update(8, { supplierName: '不应创建', productLengthCm: 10 }, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('请填写完整且大于零的长、宽、高')
    expect(tx.supplier.create).not.toHaveBeenCalled()
    expect(tx.prePurchaseOrder.update).not.toHaveBeenCalled()
  })
  it('停用供应商不能进入正式采购', async () => {
    const { service, tx } = setup(); tx.supplier.findUnique.mockResolvedValue({ id: 2n, status: 0 })
    await expect(service.confirm(8, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('供应商不存在或已停用')
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled()
  })
  it('驳回后尚未重新分配时，不能直接确认跳过分配采购员', async () => {
    const { service, row, tx } = setup(); row.convertedPoId = 9n
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 9n, prePoId: 8n, poNo: 'PO-ORIGINAL', status: 'rejected', auditedAt: new Date('2026-10-22T09:00:00Z'), items: [{ id: 11n, receivedQty: 0 }] })
    await expect(service.confirm(8, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('进入分配采购员')
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled()
  })
  it('驳回后重新分配的采购员确认时，沿用原采购单和明细，不创建第二张单', async () => {
    const { service, row, tx } = setup(); row.convertedPoId = 9n; row.assignedAt = new Date('2026-10-22T10:00:00Z')
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 9n, prePoId: 8n, poNo: 'PO-ORIGINAL', status: 'rejected', auditedAt: new Date('2026-10-22T09:00:00Z'), items: [{ id: 11n, receivedQty: 0 }] })
    tx.purchaseOrder.update = jest.fn(async ({ data }) => ({ ...data, id: 9n, poNo: 'PO-ORIGINAL' }))
    const result = await service.confirm(8, { userId: 1, roleCode: 'purchaser' })
    expect(result.poId).toBe(9); expect(result.poNo).toBe('PO-ORIGINAL'); expect(result.status).toBe('pending_actual_qty')
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled()
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalAmount: 0, items: { update: expect.objectContaining({ data: expect.objectContaining({ quantity: 0, plannedQty: 2 }) }) } }) }))
  })
  it('修改后原单已被推进时不覆盖已审核结果', async () => {
    const { service, row, tx } = setup(); row.convertedPoId = 9n
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 9n, prePoId: 8n, status: 'finance_approved', items: [{ id: 11n }] })
    await expect(service.confirm(8, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('原采购单状态已变化')
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled()
  })
  it('进行中与历史状态分别在服务端过滤，并始终限制本人范围', async () => {
    const { service, tx } = setup()
    tx.prePurchaseOrder.findMany = jest.fn().mockResolvedValue([])
    tx.prePurchaseOrder.count = jest.fn().mockResolvedValue(0)
    await service.listMy({} as any, { userId: 1, roleCode: 'purchaser' })
    await service.listMy({ status: 'cancelled' } as any, { userId: 1, roleCode: 'purchaser' })
    expect(tx.prePurchaseOrder.findMany.mock.calls[0][0].where).toMatchObject({ status: { in: ['assigned', 'returned'] }, purchaserId: 1n })
    expect(tx.prePurchaseOrder.findMany.mock.calls[1][0].where).toMatchObject({ status: 'cancelled', purchaserId: 1n })
  })
  it('驳回后修改重提清空采购员并回到待分配', async () => {
    const { service, row, tx } = setup()
    row.status = 'returned'
    row.convertedPoId = 9n
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 9n, prePoId: 8n, poNo: 'PO-ORIGINAL', status: 'rejected' })
    tx.prePurchaseOrder.updateMany = jest.fn(async () => ({ count: 1 }))
    tx.prePurchaseOrder.findUniqueOrThrow = jest.fn(async () => ({ ...row, status: 'pending_assign', purchaserId: null }))
    jest.spyOn(service, 'update').mockResolvedValue({} as any)
    jest.spyOn(service as any, 'enrich').mockImplementation(async (rows: any[]) => rows)
    const item = await service.resubmitRejected(9, { remark: '已改价' }, { userId: 1, roleCode: 'purchaser' })
    expect(service.update).toHaveBeenCalledWith(8, { remark: '已改价' }, { userId: 1, roleCode: 'purchaser' })
    expect(tx.prePurchaseOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'pending_assign', purchaserId: null, assignerId: null, assignedAt: null },
    }))
    expect(item.status).toBe('pending_assign')
    expect(item.purchaserId).toBeNull()
  })
  it('没有关联预采购的驳回单不能退回分配', async () => {
    const { service, tx } = setup()
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 9n, prePoId: null, status: 'rejected' })
    await expect(service.resubmitRejected(9, {}, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('没有关联预采购')
  })
  it('已取消且没有采购单的预采购可以删除', async () => {
    const { service, row, tx, log } = setup()
    row.status = 'cancelled'
    row.convertedPoId = null
    tx.prePurchaseOrder.delete = jest.fn()
    await service.removeCancelled(8, { userId: 1, roleCode: 'purchaser' })
    expect(tx.prePurchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 8n } })
    expect(log.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', targetId: 'PRE-AUDIT-PD' }))
  })
  it('进行中或仍关联采购单的预采购不能删除', async () => {
    const { service, row, tx } = setup()
    tx.prePurchaseOrder.delete = jest.fn()
    await expect(service.removeCancelled(8, { userId: 1, roleCode: 'purchaser' })).rejects.toThrow('仅已取消')
    row.status = 'cancelled'
    row.convertedPoId = 9n
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 9n, poNo: 'PO-KEEP' })
    await expect(service.removeCancelled(8, { userId: 1, roleCode: 'admin' })).rejects.toThrow('PO-KEEP')
    expect(tx.prePurchaseOrder.delete).not.toHaveBeenCalled()
  })
  it('未知状态筛选返回中文提示', async () => {
    await expect(setup().service.listMy({ status: 'invalid' } as any)).rejects.toThrow('请选择有效的预采购处理状态')
  })
})
