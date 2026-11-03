import { PurchaseService } from './purchase.service'
import { computePoFinanceApprovalCosts } from '../../common/po-finance-cost.util'

describe('同SKU多采购明细的费用及商品汇总', () => {
  const items = [{ id: 11n, sku: 'A', quantity: 2, unitPrice: 2, domesticFreight: 1 }, { id: 12n, sku: 'A', quantity: 3, unitPrice: 3, domesticFreight: 2 }]
  it('多SKU审核不把单头SKU的规格、尺寸、重量、图片或开发员写到其它SKU', async () => {
    const service: any = Object.create(PurchaseService.prototype)
    const pre = { sku:'A',devId:10n,spec:'A规格',packageLengthCm:20,packageWidthCm:21,packageHeightCm:22,packageWeightKg:2,productLink:'https://example.test/a',productImageUrl:'/a.png' }
    const dev = {sku:'B',spec:'B规格',packageLengthCm:40,packageWidthCm:41,packageHeightCm:42,packageWeightKg:4,takealotUrl:'https://example.test/b',takealotPriceImageUrl:'/b.png',applicantId:20n,applyNo:'DEV-B'}
    const update=jest.fn().mockResolvedValue({id:7n}),findFirst=jest.fn().mockResolvedValue(dev)
    const tx:any={prePurchaseOrder:{findUnique:async()=>pre},productDev:{findFirst},product:{findUnique:async()=>({id:7n}),update},purchaseOrderItem:{update:jest.fn()}}
    await service.syncProductMasterFromLine(tx,{prePoId:1n,supplierId:3n},{id:11n,sku:'B',unitPrice:3})
    expect(findFirst).toHaveBeenCalledWith({where:{sku:{in:expect.arrayContaining(['B','TKL-B'])},status:'approved'},orderBy:{id:'desc'}})
    expect(update).toHaveBeenCalledWith({where:{sku:'B'},data:expect.objectContaining({spec:'B规格',lengthCm:40,widthCm:41,heightCm:42,weightKg:4,takealotUrl:'https://example.test/b',imageUrl:'/b.png',developerId:20n,remark:'选品申请 DEV-B'})})
  })
  it('匹配同一SKU别名的确认资料仍优先，关联开发记录也必须匹配该SKU', async () => {
    const service:any=Object.create(PurchaseService.prototype),update=jest.fn().mockResolvedValue({id:7n}),findFirst=jest.fn().mockResolvedValue(null)
    const tx:any={prePurchaseOrder:{findUnique:async()=>({sku:'TKL-A',devId:10n,spec:'确认规格',packageLengthCm:25,packageWeightKg:2})},productDev:{findFirst},product:{findUnique:async()=>({id:7n}),update},purchaseOrderItem:{update:jest.fn()}}
    await service.syncProductMasterFromLine(tx,{prePoId:1n},{id:11n,sku:'A',unitPrice:3})
    expect(findFirst).toHaveBeenCalledWith({where:{id:10n,sku:{in:expect.arrayContaining(['A','TKL-A'])}},orderBy:{id:'desc'}})
    expect(update.mock.calls[0][0].data).toEqual(expect.objectContaining({spec:'确认规格',lengthCm:25,weightKg:2,imageUrl:undefined,developerId:undefined}))
  })
  it('相同SKU的货款、运费、税费仍按明细ID精确对应', () => {
    const result = computePoFinanceApprovalCosts({ poNo: 'PO-DUP', items }, { unitTax: 0.5 })
    expect(result.entries.filter(x => x.poItemId === '11').map(x => x.amountRmb)).toEqual([4, 1, 1])
    expect(result.entries.filter(x => x.poItemId === '12').map(x => x.amountRmb)).toEqual([9, 2, 1.5])
    expect(result.total).toBe(18.5)
  })

  it('成本编号每明细每类型唯一，同SKU不会从首行重复拷贝金额', async () => {
    const service: any = Object.create(PurchaseService.prototype), createMany = jest.fn()
    const po = { id: 10n, poNo: 'PO-DUP', items }
    await service.createCostLedgersForFinanceApproval({ costLedger: { createMany } }, po, items.map(line => ({ line, product: { id: 7n } })), 1, computePoFinanceApprovalCosts(po, { unitTax: 0.5 }))
    const rows = createMany.mock.calls[0][0].data
    expect(rows.map(row => row.amountRmb)).toEqual([4, 1, 1, 9, 2, 1.5])
    expect(new Set(rows.map(row => row.costNo)).size).toBe(6)
  })

  it('同SKU只同步一次商品，数量合计5、加权成本2.6、运费0.6，所有原明细关联商品', async () => {
    const service: any = Object.create(PurchaseService.prototype)
    service.opLog = { log: jest.fn() }
    service.syncProductMasterFromLine = jest.fn().mockResolvedValue({ id: 7n })
    service.ensureCostRecordsForPo = jest.fn()
    const tx: any = { sysUser: { findUnique: jest.fn().mockResolvedValue({realName:'采购验收员'}) }, operationLog:{create:jest.fn()}, purchaseOrderItem: { update: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 5 } }) }, productPricing: { findFirst: jest.fn().mockResolvedValue({ sku: 'TKL-A', poNo: 'PO-DUP', purchaseQty: 99 }), update: jest.fn(), create: jest.fn() } }
    const po = { id: 10n, poNo: 'PO-DUP', items: items.map(x => ({ ...x })) }
    await service.applyPostAuditEffects(tx, po, 1)
    expect(service.syncProductMasterFromLine).toHaveBeenCalledTimes(1)
    expect(service.syncProductMasterFromLine).toHaveBeenCalledWith(tx, po, expect.objectContaining({ quantity: 5, unitPrice: 2.6 }), 0.6)
    expect(tx.productPricing.update).toHaveBeenCalledWith({ where: { sku: 'TKL-A' }, data: expect.objectContaining({ purchaseQty: 5, costRmb: 2.6, domesticFee: 0.6 }) })
    expect(po.items.every((line: any) => line.productId === 7n)).toBe(true)
    expect(service.ensureCostRecordsForPo).toHaveBeenCalledWith(tx, po, 1)
    expect(tx.operationLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:'sync_from_po',targetId:'A',operatorName:'采购验收员'})}))
    expect(service.opLog.log).not.toHaveBeenCalled()
  })

  it('重新审核使用当前所有有效采购数量，既不清除前批也不累加旧缓存', async () => {
    const service: any = Object.create(PurchaseService.prototype)
    service.opLog = { log: jest.fn() };service.syncProductMasterFromLine = jest.fn().mockResolvedValue({ id: 7n });service.ensureCostRecordsForPo = jest.fn()
    const aggregate = jest.fn().mockResolvedValue({ _sum: { quantity: 10 } }), update = jest.fn()
    const tx: any = { sysUser: { findUnique: jest.fn().mockResolvedValue({realName:'采购验收员'}) }, operationLog:{create:jest.fn()}, purchaseOrderItem: { update: jest.fn(), aggregate }, productPricing: { findFirst: jest.fn().mockResolvedValue({ sku: 'TKL-A', poNo: 'PO-DUP', purchaseQty: 999 }), update } }
    const po = { id: 10n, poNo: 'PO-DUP', items: items.map(x => ({ ...x })) }
    await service.applyPostAuditEffects(tx, po, 1);await service.applyPostAuditEffects(tx, po, 1)
    expect(update.mock.calls.map(call => call[0].data.purchaseQty)).toEqual([10, 10])
    expect(aggregate.mock.calls[0][0].where.order.status.notIn).toEqual(expect.arrayContaining(['draft', 'cancelled', 'rejected', 'voided', 'pending_actual_qty']))
  })
})
