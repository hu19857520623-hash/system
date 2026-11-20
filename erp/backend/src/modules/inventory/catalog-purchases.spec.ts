import { BadRequestException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { readCatalogPurchases } from './catalog-purchases.util'
import { readCatalogRefunds } from '../billing/catalog-refund-ledger.util'
import { CatalogPurchaseQueryDto } from './dto/catalog-purchase-query.dto'
jest.mock('../billing/catalog-refund-ledger.util',()=>({readCatalogRefunds:jest.fn()}))
function fixture(){
 const order:any={id:9n,orderNo:'CAT-20261013699361',sku:'FUR-LVR-SID-011',customerId:256n,customerCode:'TKL0444',quantity:9,unitPrice:'109',totalAmount:'981',balanceBefore:'14849',balanceAfter:'13868',status:'confirmed',priceTier:'B',pricingId:647n,createdAt:new Date('2026-10-13T08:38:19Z')}
 const customer={id:256n,customerCode:'TKL0444',customerName:'客户甲'}
 const product={id:647n,sku:'FUR-LVR-SID-011',productName:'床头柜',finalPrice:999}
 const db:any={customer:{findMany:jest.fn().mockResolvedValue([customer])},productPricing:{findMany:jest.fn().mockResolvedValue([product])},omsCatalogOrder:{findMany:jest.fn().mockResolvedValue([order]),count:jest.fn().mockResolvedValue(1),aggregate:jest.fn().mockResolvedValue({_sum:{quantity:9}})}}
 const prisma:any={$transaction:jest.fn().mockImplementation((fn:any)=>fn(db))}
 return {prisma,db,order,customer,product}
}
beforeEach(()=>{jest.clearAllMocks();(readCatalogRefunds as jest.Mock).mockResolvedValue([])})
describe('OMS货盘采购记录只读查询',()=>{
 it('保留原成交价格与档位，不使用商品当前售价，已退5件展示净4件436元',async()=>{
  const f=fixture();(readCatalogRefunds as jest.Mock).mockResolvedValue([{referenceNo:'RCL-1',createdAt:new Date(),allocations:[{orderId:9,quantity:5,amountCents:54500}]}])
  const r=await readCatalogPurchases(f.prisma,{page:1,pageSize:20});expect(r.items[0]).toMatchObject({orderNo:f.order.orderNo,quantity:9,unitPrice:109,priceTier:'B',productName:'床头柜',refundedQuantity:5,refundAmount:545,netQuantity:4,netAmount:436,refundVerified:true,refunds:[{referenceNo:'RCL-1',quantity:5,amount:545}]});expect(r.items[0]).not.toHaveProperty('totalAmount');expect(r.summary).toEqual({quantity:9});expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),expect.objectContaining({isolationLevel:'RepeatableRead'}));expect(f.order.quantity).toBe(9)
 })
 it('没有退回记录时显示原数量，不依赖当前持有库存',async()=>{const f=fixture();const r=await readCatalogPurchases(f.prisma,{});expect(r.items[0]).toMatchObject({netQuantity:9,netAmount:null,refundedQuantity:0});expect(f.prisma.customerSkuInventory).toBeUndefined()})
 it('多笔退回仅汇总当前订单的已审核分摊',async()=>{const f=fixture();(readCatalogRefunds as jest.Mock).mockResolvedValue([{referenceNo:'R1',allocations:[{orderId:9,quantity:2,amountCents:21800},{orderId:99,quantity:10,amountCents:10000}]},{referenceNo:'R2',allocations:[{orderId:9,quantity:3,amountCents:32700}]}]);const r=await readCatalogPurchases(f.prisma,{});expect(r.items[0]).toMatchObject({refundedQuantity:5,refundAmount:545,netQuantity:4,netAmount:436});expect(r.items[0].refunds).toHaveLength(2)})
 it('退款凭据损坏时仍展示原采购，退回与净额标待核对',async()=>{const f=fixture();(readCatalogRefunds as jest.Mock).mockRejectedValue(new BadRequestException('历史退款回执不完整'));const r=await readCatalogPurchases(f.prisma,{});expect(r.items[0]).toMatchObject({quantity:9,refundVerified:false,refundedQuantity:null,netQuantity:null,netAmount:null});expect(r.warnings[0]).toContain('TKL0444')})
 it('数据库错误不伪装为零退款',async()=>{const f=fixture();(readCatalogRefunds as jest.Mock).mockRejectedValue(Error('database offline'));await expect(readCatalogPurchases(f.prisma,{})).rejects.toThrow('database offline')})
 it('旧采购单客户代码为空时通过客户ID回填',async()=>{const f=fixture();f.order.customerCode=null;const r=await readCatalogPurchases(f.prisma,{customerCode:'TKL0444'});expect(r.items[0].customerCode).toBe('TKL0444');expect(f.db.omsCatalogOrder.findMany.mock.calls[0][0].where.AND).toContainEqual({OR:[{customerCode:'TKL0444'},{customerId:{in:[256n]}}]})})
 it('商品名、客户名、采购单号及状态组合筛选作用于列表、总数及汇总',async()=>{const f=fixture();await readCatalogPurchases(f.prisma,{customerKeyword:'客户甲',productKeyword:'床头柜',orderNo:'699361',status:'confirmed'});const where=f.db.omsCatalogOrder.findMany.mock.calls[0][0].where;expect(where.AND).toContainEqual({orderNo:{contains:'699361'}});expect(where.AND).toContainEqual({status:'confirmed'});expect(where.AND).toContainEqual({OR:[{sku:{contains:'床头柜'}},{sku:{in:expect.arrayContaining(['FUR-LVR-SID-011','TKL-FUR-LVR-SID-011'])}},{pricingId:{in:[647n]}}]});expect(f.db.omsCatalogOrder.count).toHaveBeenCalledWith({where});expect(f.db.omsCatalogOrder.aggregate).toHaveBeenCalledWith({where,_sum:{quantity:true}})})
 it('完整SKU兼容货盘前缀，不以当前库存过滤历史单',async()=>{const f=fixture();await readCatalogPurchases(f.prisma,{sku:'TKL-FUR-LVR-SID-011'});expect(f.db.omsCatalogOrder.findMany.mock.calls[0][0].where.AND).toContainEqual({sku:{in:['TKL-FUR-LVR-SID-011','FUR-LVR-SID-011']}})})
 it('按北京时间自然日筛选，结束日包含全天',async()=>{const f=fixture();await readCatalogPurchases(f.prisma,{startDate:'2026-10-13',endDate:'2026-10-13'});const where=f.db.omsCatalogOrder.findMany.mock.calls[0][0].where;expect(where.AND).toContainEqual({createdAt:{gte:new Date('2026-10-12T16:00:00Z'),lt:new Date('2026-10-13T16:00:00Z')}})})
 it.each([{startDate:'2026-02-30'},{startDate:'not-date'},{startDate:'2026-11-17',endDate:'2026-11-16'}])('无效日期不执行查询 %p',async q=>{const f=fixture();await expect(readCatalogPurchases(f.prisma,q)).rejects.toThrow();expect(f.prisma.$transaction).not.toHaveBeenCalled()})
 it('分页使用稳定时间与ID排序，超200条被限制',async()=>{const f=fixture();await readCatalogPurchases(f.prisma,{page:2,pageSize:1000});expect(f.db.omsCatalogOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({skip:200,take:200,orderBy:[{createdAt:'desc'},{id:'desc'}]}))})
 it('空结果返回零汇总且不读取任何客户退款',async()=>{const f=fixture();f.db.omsCatalogOrder.findMany.mockResolvedValue([]);f.db.omsCatalogOrder.count.mockResolvedValue(0);f.db.omsCatalogOrder.aggregate.mockResolvedValue({_sum:{quantity:null}});const r=await readCatalogPurchases(f.prisma,{});expect(r).toMatchObject({items:[],total:0,summary:{quantity:0}});expect(readCatalogRefunds).not.toHaveBeenCalled()})
 it('DTO拒绝非法分页、超长文本、未知状态和日期对象',async()=>{for(const q of [{pageSize:201},{customerKeyword:'a'.repeat(101)},{status:'hacked'},{startDate:{}},{sku:{contains:'x'}}])expect((await validate(plainToInstance(CatalogPurchaseQueryDto,q))).length).toBeGreaterThan(0)})
})
