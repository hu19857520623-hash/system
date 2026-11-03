import { PrePurchaseService } from './pre-purchase.service'

function setup() {
  const row: any = { id: 8n, devId: 12n, sku: 'AUDIT-PD', prePoNo: 'PRE-AUDIT-PD', status: 'assigned', purchaserId: 1n, supplierId: 2n, plannedQty: 2, unitPrice: 10, spec: '虚构规格', productName: '虚构商品', productVolumeCbm: 0.001, packageVolumeCbm: 0.002 }
  let po: any = null
  const audits:any[]=[]
  const tx: any = {
    sysUser:{findUnique:jest.fn().mockResolvedValue({roleCode:'purchaser',status:1,realName:'采购验收员'})},
    operationLog:{create:jest.fn(async({data})=>{audits.push(data);return {id:audits.length,...data}}),findFirst:jest.fn(async({where})=>audits.find(x=>x.targetId===where.targetId&&x.detail?.conversionKey===where.detail.equals)||null)},
    $queryRaw: jest.fn().mockResolvedValue([]),
    prePurchaseOrder: { findUnique: jest.fn(async () => ({ ...row })),findUniqueOrThrow:jest.fn(async()=>({...row})),updateMany:jest.fn(async({data})=>{Object.assign(row,data);return {count:1}}),delete:jest.fn(), update: jest.fn(async ({ data }) => { Object.assign(row, data); return { ...row } }) },
    supplier: { findUnique: jest.fn().mockResolvedValue({ id: 2n, status: 1 }), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 3n }) },
    purchaseOrder: { create: jest.fn(async ({ data }) => { po = { ...data, id: 9n }; return po }), findUnique: jest.fn(async () => po) },
    product: { findFirst: jest.fn().mockResolvedValue(null) }, productDev: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
  }
  const prisma = { ...tx, $transaction: jest.fn(async callback => callback(tx)) }
  const log = { log: jest.fn().mockResolvedValue({}) }
  const service = new PrePurchaseService(prisma as any, log as any)
  jest.spyOn(service as any,'enrich').mockImplementation(async(rows:any[])=>rows)
  return { service, row, tx, log }
}

describe('预采购确认与所属采购员', () => {
  it('首次确认的转换日志失败向业务事务抛出，不在提交后写日志',async()=>{
    const {service,tx,log}=setup();tx.operationLog.create.mockRejectedValueOnce(new Error('转换日志失败'))
    await expect(service.confirm(8,{userId:1,roleCode:'purchaser'})).rejects.toThrow('转换日志失败')
    expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(1);expect(log.log).not.toHaveBeenCalled()
  })
  it('旧转换缺日志时只补一次当前重试核对记录，不重建采购或伪造旧操作者',async()=>{
    const {service,row,tx,log}=setup();row.status='confirmed';row.convertedPoId=9n;row.confirmedAt=new Date('2026-11-03T00:00:00Z');tx.purchaseOrder.findUnique.mockResolvedValue({id:9n,prePoId:8n,poNo:'PO-OLD',status:'pending_actual_qty'})
    const first=await service.confirm(8,{userId:1,roleCode:'purchaser'}),again=await service.confirm(8,{userId:1,roleCode:'purchaser'})
    expect(first.duplicate).toBe(true);expect(again.poId).toBe(9);expect(tx.purchaseOrder.create).not.toHaveBeenCalled();expect(tx.prePurchaseOrder.update).not.toHaveBeenCalled()
    expect(tx.operationLog.create).toHaveBeenCalledTimes(1);expect(tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({operatorId:1n,detail:expect.objectContaining({recoveredOnRetry:true,conversionKey:'9:2026-11-03T00:00:00.000Z',message:expect.stringContaining('未重复建单')})})}));expect(log.log).not.toHaveBeenCalled()
  })
  it.each([['分配','pending_assign',(s:any)=>s.assign(8,1,1)],['取消','assigned',(s:any)=>s.cancel(8,'虚构取消',{userId:1,roleCode:'purchaser'})],['删除','cancelled',(s:any)=>s.removeCancelled(8,{userId:1,roleCode:'purchaser'})]])('%s日志失败使事务拒绝，不调用独立日志连接',async(_label,status,run)=>{
    const {service,row,tx,log}=setup();row.status=status;tx.operationLog.create.mockRejectedValueOnce(new Error('预采购日志失败'))
    await expect((run as (s:any)=>Promise<any>)(service)).rejects.toThrow('预采购日志失败');expect(tx.operationLog.create).toHaveBeenCalledTimes(1);expect(log.log).not.toHaveBeenCalled()
  })
  it('驳回重提的资料修改、分配重置与日志属于同一事务',async()=>{
    const {service,row,tx,log}=setup();row.status='returned';row.convertedPoId=9n;tx.purchaseOrder.findUnique.mockResolvedValue({id:9n,prePoId:8n,status:'rejected',poNo:'PO-OLD'});tx.operationLog.create.mockRejectedValueOnce(new Error('重提日志失败'))
    await expect(service.resubmitRejected(9,{remark:'已改资料'},{userId:1,roleCode:'purchaser'})).rejects.toThrow('重提日志失败');expect(row.remark).toBe('已改资料');expect(tx.prePurchaseOrder.updateMany).toHaveBeenCalledTimes(1);expect(log.log).not.toHaveBeenCalled()
  })
  it('预采购编辑的响应读取在写入事务内，读取失败向事务抛出',async()=>{
    const {service,tx}=setup();jest.mocked((service as any).enrich).mockRejectedValueOnce(new Error('资料读取失败'))
    await expect(service.update(8,{remark:'资料修改'},{userId:1,roleCode:'purchaser'})).rejects.toThrow('资料读取失败');expect((service as any).enrich).toHaveBeenCalledWith([expect.anything()],tx)
  })
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
    expect(tx.operationLog.create).toHaveBeenCalledTimes(1);expect(log.log).not.toHaveBeenCalled()
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
  it('审核通过后转入的草稿采购单，确认时沿用原单', async () => {
    const { service, row, tx } = setup()
    row.convertedPoId = 9n
    row.assignedAt = new Date('2026-10-22T10:00:00Z')
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 9n, prePoId: 8n, poNo: 'PO-DRAFT', status: 'draft', items: [{ id: 11n, receivedQty: 0 }] })
    tx.purchaseOrder.update = jest.fn(async ({ data }) => ({ ...data, id: 9n, poNo: 'PO-DRAFT' }))
    const result = await service.confirm(8, { userId: 1, roleCode: 'purchaser' })
    expect(result.poNo).toBe('PO-DRAFT')
    expect(result.status).toBe('pending_actual_qty')
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled()
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
    const update = jest.spyOn(service as any, 'updateInTransaction')
    jest.spyOn(service as any, 'enrich').mockImplementation(async (rows: any[]) => rows)
    const item = await service.resubmitRejected(9, { remark: '已改价' }, { userId: 1, roleCode: 'purchaser' })
    expect(update).toHaveBeenCalledWith(tx,8,{remark:'已改价'},{userId:1,roleCode:'purchaser'})
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(tx.prePurchaseOrder.updateMany.mock.invocationCallOrder[0])
    expect(tx.prePurchaseOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'pending_assign', purchaserId: null, assignerId: null, assignedAt: null },
    }))
    expect(item.status).toBe('pending_assign')
    expect(item.purchaserId).toBeNull()
  })
  it('没有关联预采购的驳回单按明细生成预采购并进入分配', async () => {
    const { service, tx, log } = setup()
    const direct = { id: 9n, prePoId: null, poNo: 'PO-DIRECT', status: 'rejected', supplierId: 2n, purchaserId: 1n, warehouseCode: 'LW-SZ', items: [{ id: 11n, sku: '22222', productName: '01111', quantity: 1, plannedQty: 1, unitPrice: 20 }] }
    tx.purchaseOrder.findUnique.mockImplementation(async () => direct)
    tx.purchaseOrder.update = jest.fn(async ({ data }) => ({ ...direct, ...data }))
    tx.productDev = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => ({ id: 21n, applyNo: data.applyNo, ...data })) }
    tx.prePurchaseOrder.create = jest.fn(async ({ data }) => ({ id: 31n, ...data }))
    tx.warehouse = { findUnique: jest.fn().mockResolvedValue({ warehouseCode: 'LW-SZ', status: 1, warehouseType: 'logistics' }) }
    jest.spyOn(service as any, 'enrich').mockImplementation(async (rows: any[]) => rows)
    const item = await service.resubmitRejected(9, { sku: '22222', productName: '01111', plannedQty: 1, unitPrice: 20, supplierName: '宁波百晟钣金制造有限公司', warehouseCode: 'LW-SZ' }, { userId: 1, roleCode: 'purchaser' })
    expect(tx.productDev.create).toHaveBeenCalled()
    expect(tx.prePurchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_assign', sku: '22222', convertedPoId: 9n }),
    }))
    expect(item.status).toBe('pending_assign')
    expect(tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({ detail: expect.objectContaining({ createdFromDirectPo: true }) })}))
    expect(log.log).not.toHaveBeenCalled()
  })
  it('已取消且没有采购单的预采购可以删除', async () => {
    const { service, row, tx, log } = setup()
    row.status = 'cancelled'
    row.convertedPoId = null
    tx.prePurchaseOrder.delete = jest.fn()
    await service.removeCancelled(8, { userId: 1, roleCode: 'purchaser' })
    expect(tx.prePurchaseOrder.delete).toHaveBeenCalledWith({ where: { id: 8n } })
    expect(tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({ action: 'delete', targetId: 'PRE-AUDIT-PD' })}))
    expect(log.log).not.toHaveBeenCalled()
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
