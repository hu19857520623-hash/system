import { reclaimCatalog, previewCatalogReclaim } from './catalog-reclaim.util'
import { readCatalogRefunds } from '../billing/catalog-refund-ledger.util'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CatalogReclaimDto } from './dto/catalog-reclaim.dto'
const request = { clientRequestId: 'b2c08385-39ac-4e33-8415-80310f3c9711', customerCode: 'TKL9001', sku: 'TKL-A', quantity: 1, remark: '按原购买单退款', allocations: [{orderId:21,quantity:1}], expectedRefundAmount:1.25 }
function fixture() {
  let state:any={customer:{id:1n,customerCode:'TKL9001',status:1,balance:'10.00'},pricing:{id:10n,sku:'TKL-A',soldQty:6,visibleStockQty:6,finalPrice:'999.00'},holdings:[{id:4n,customerId:1n,sku:'TKL-A',quantity:4,unitPrice:88}],logs:[],histories:[],syncs:[],orders:[
    {id:21n,customerId:1n,customerCode:'TKL9001',sku:'TKL-A',orderNo:'CAT-OLD-1',quantity:2,unitPrice:'1.25',totalAmount:'2.50',balanceBefore:'100',balanceAfter:'97.50',status:'confirmed'},
    {id:22n,customerId:1n,customerCode:'TKL9001',sku:'TKL-A',orderNo:'CAT-OLD-2',quantity:4,unitPrice:'2.25',totalAmount:'9.00',balanceBefore:'97.50',balanceAfter:'88.50',status:'confirmed'}],charges:[{id:31n,bizRef:'CAT-OLD-1',amount:'2.50',status:'confirmed'},{id:32n,bizRef:'CAT-OLD-2',amount:'9.00',status:'confirmed'}]}
  const tx:any={
    sysUser:{findUnique:jest.fn().mockResolvedValue({roleCode:'admin',status:1})},
    sysUserPermission:{findMany:jest.fn().mockResolvedValue([])},
    sysRolePermission:{findMany:jest.fn().mockResolvedValue([])},
    $queryRaw:jest.fn().mockResolvedValue([]),
    customer:{findUnique:jest.fn(async ({where})=>where.customerCode&&where.customerCode!==state.customer.customerCode?null:{...state.customer}),update:jest.fn(async ({data})=>{state.customer.balance=(Number(state.customer.balance)+Number(data.balance.increment)).toFixed(2);return {...state.customer}})},
    productPricing:{findUnique:jest.fn(async()=>({...state.pricing})),findFirst:jest.fn(async()=>({...state.pricing})),updateMany:jest.fn(async ({where,data})=>{if(state.pricing.soldQty<where.soldQty.gte)return {count:0};state.pricing.soldQty-=data.soldQty.decrement;return {count:1}})},
    customerSkuInventory:{findMany:jest.fn(async()=>state.holdings.filter(h=>h.quantity>0).map(h=>({...h}))),updateMany:jest.fn(async ({where,data})=>{const h=state.holdings.find(h=>h.id===where.id&&h.quantity>=where.quantity.gte);if(!h)return {count:0};h.quantity-=data.quantity.decrement;return {count:1}}),deleteMany:jest.fn(async()=>{state.holdings=state.holdings.filter(h=>h.quantity!==0);return {count:1}})},
    omsCatalogOrder:{findMany:jest.fn(async ({where})=>state.orders.filter(o=>(!where.id||where.id.in.includes(o.id))&&(!where.sku||where.sku.in.includes(o.sku))))},
    billingCharge:{findMany:jest.fn(async()=>state.charges)},
    operationLog:{findFirst:jest.fn(async ({where})=>state.logs.find(l=>l.operatorId===where.operatorId&&l.detail.clientRequestId===where.detail.equals)),findMany:jest.fn(async()=>state.logs),create:jest.fn(async ({data})=>{state.logs.push({...data,id:BigInt(state.logs.length+1),createdAt:new Date('2026-10-23')});return data})},
    productPricingHistory:{create:jest.fn(async ({data})=>{state.histories.push(data)})},syncLog:{create:jest.fn(async ({data})=>{state.syncs.push(data)})},
    warehouse:{findMany:jest.fn().mockResolvedValue([{warehouseCode:'WMS-JHB-01'}])},inventory:{findFirst:jest.fn().mockResolvedValue({availableQty:4})},
  }
  const prisma={$transaction:jest.fn(async (work:any)=>{const before=structuredClone(state);try{return await work(tx)}catch(error){state=before;throw error}})}
  return {prisma,tx,state:()=>state}
}
describe('货盘收回与原购买退款的原子事务',()=>{
  it('从选定原购买单退款，忽略当前售价和持有均价',async()=>{
    const f=fixture(),r=await reclaimCatalog(f.prisma,request,7)
    expect(r).toMatchObject({remainingQty:3,catalogSoldQty:5,refundAmount:1.25,balanceBefore:10,balanceAfter:11.25})
    expect(f.state().customer.balance).toBe('11.25');expect(f.state().logs).toHaveLength(1)
    expect((await readCatalogRefunds(f.tx,f.state().customer))[0]).toMatchObject({amount:1.25,allocations:[{orderNo:'CAT-OLD-1',quantity:1,unitCents:125}]})
  })
  it('不同购买价格分摊合计按分币准确退款',async()=>{
    const f=fixture();expect(await reclaimCatalog(f.prisma,{...request,quantity:3,allocations:[{orderId:21,quantity:1},{orderId:22,quantity:2}],expectedRefundAmount:5.75},7)).toMatchObject({refundAmount:5.75,balanceAfter:15.75,remainingQty:1})
  })
  it('原请求重试不再扣持有或退款，即使原持有已删除',async()=>{
    const f=fixture(),body={...request,quantity:4,allocations:[{orderId:22,quantity:4}],expectedRefundAmount:9};await reclaimCatalog(f.prisma,body,7)
    const after=structuredClone(f.state());expect(await reclaimCatalog(f.prisma,body,7)).toMatchObject({duplicate:true,refundAmount:9});expect(f.state()).toEqual(after)
  })
  it('拒绝修改已完成原请求的购买单或金额',async()=>{
    const f=fixture();await reclaimCatalog(f.prisma,request,7);const before=structuredClone(f.state())
    await expect(reclaimCatalog(f.prisma,{...request,expectedRefundAmount:2.25,allocations:[{orderId:22,quantity:1}]},7)).rejects.toThrow('原收回请求对应');expect(f.state()).toEqual(before)
  })
  it('最后回执写入失败，余额、持有、已售和历史一起回滚',async()=>{
    const f=fixture(),before=structuredClone(f.state());f.tx.operationLog.create.mockRejectedValue(new Error('receipt fault'))
    await expect(reclaimCatalog(f.prisma,request,7)).rejects.toThrow('receipt fault');expect(f.state()).toEqual(before)
  })
  it('原购买数量已退款的部分不可再次退',async()=>{
    const f=fixture();await reclaimCatalog(f.prisma,{...request,quantity:2,allocations:[{orderId:21,quantity:2}],expectedRefundAmount:2.5},7)
    const before=structuredClone(f.state())
    await expect(reclaimCatalog(f.prisma,{...request,clientRequestId:'e12145a1-c716-4ff2-8b6b-2e82ac83bbe5'},8)).rejects.toThrow('可退款数量');expect(f.state()).toEqual(before)
  })
  it('余额可并发变动，但本次只增加固定原单退款金额',async()=>{
    const f=fixture();f.state().customer.balance='12.05';expect(await reclaimCatalog(f.prisma,request,7)).toMatchObject({balanceBefore:12.05,balanceAfter:13.3})
  })
  it.each([true,'1',1.5,0,-1,Infinity])('严格拒绝非正整数量 %p',async quantity=>{
    const f=fixture();await expect(reclaimCatalog(f.prisma,{...request,quantity} as any,7)).rejects.toThrow('正整数');expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each([{allocations:[]},{allocations:[{orderId:21,quantity:1},{orderId:21,quantity:1}]},{allocations:[{orderId:21,quantity:2}]}])('分摊缺失、重复或数量不符时不退款 %p',async change=>{
    const f=fixture();await expect(reclaimCatalog(f.prisma,{...request,...change},7)).rejects.toThrow();expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })
  it('客户端报价不等于原单时不扣持有、不退款',async()=>{
    const f=fixture(),before=structuredClone(f.state());await expect(reclaimCatalog(f.prisma,{...request,expectedRefundAmount:999},7)).rejects.toThrow('退款金额');expect(f.state()).toEqual(before)
  })
  it('无付款依据不能猜测成已付款退款',async()=>{
    const f=fixture();f.state().orders[0].balanceBefore=null
    await expect(reclaimCatalog(f.prisma,request,7)).rejects.toThrow('付款依据');expect(f.state().customer.balance).toBe('10.00')
  })
  it('无可收回持有时，已预约锁定不能退款',async()=>{
    const f=fixture();f.state().holdings=[];await expect(reclaimCatalog(f.prisma,request,7)).rejects.toThrow('当前可收回仅 0');expect(f.tx.customer.update).not.toHaveBeenCalled()
  })
  it('重复编码或已售小于收回量时要求核对，不能抹平差异',async()=>{
    const f=fixture();f.state().holdings.push({...f.state().holdings[0],id:5n,sku:'A'})
    await expect(reclaimCatalog(f.prisma,request,7)).rejects.toThrow('多份持有')
    f.state().holdings.pop();f.state().pricing.soldQty=0;await expect(reclaimCatalog(f.prisma,request,7)).rejects.toThrow('已售记录不一致')
  })
  it('预览只读，列出原价及已退款数量',async()=>{
    const f=fixture(),before=structuredClone(f.state());const preview=await previewCatalogReclaim(f.prisma,request,7)
    expect(preview).toMatchObject({holdingQuantity:4,lots:[{unitPrice:1.25,refundableQuantity:2},{unitPrice:2.25,refundableQuantity:4}]});expect(f.state()).toEqual(before)
  })
  it('退款释放可售配额，有仓存时恢复申购，人工停售不被打开',async()=>{
    const f=fixture();f.state().pricing.visibleOnOms=true;f.state().pricing.orderableOnOms=false;f.state().pricing.shareStatus='enabled'
    await reclaimCatalog(f.prisma,request,7)
    expect(f.tx.productPricing.updateMany.mock.calls[0][0].data).toMatchObject({orderableOnOms:true})
    const stopped=fixture();stopped.state().pricing.visibleOnOms=true;stopped.state().pricing.shareStatus='stopped'
    await reclaimCatalog(stopped.prisma,request,7);expect(stopped.tx.productPricing.updateMany.mock.calls[0][0].data).not.toHaveProperty('orderableOnOms')
  })
  it('伪造或残缺退款回执不能用于再退款或账务展示',async()=>{
    const f=fixture();await reclaimCatalog(f.prisma,request,7);f.state().logs[0].detail.refund.amountCents=999
    await expect(readCatalogRefunds(f.tx,f.state().customer)).rejects.toThrow('退款回执不完整')
  })
  it('DTO不把布尔退款金额或分摊数量转成数字',async()=>{
    expect((await validate(plainToInstance(CatalogReclaimDto,{...request,expectedRefundAmount:true,allocations:[{orderId:21,quantity:true}]}))).length).toBeGreaterThan(0)
  })
  it.each([{roleCode:'viewer',status:1},{roleCode:'admin',status:0},{roleCode:'finance',status:0},null])('旧令牌不能绕过当前岗位、停用或删除账号 %p',async user=>{
    const f=fixture(),before=structuredClone(f.state());f.tx.sysUser.findUnique.mockResolvedValue(user)
    await expect(reclaimCatalog(f.prisma,request,7)).rejects.toThrow('仅当前财务')
    await expect(previewCatalogReclaim(f.prisma,request,7)).rejects.toThrow('仅当前财务')
    expect(f.state()).toEqual(before);expect(f.tx.customer.update).not.toHaveBeenCalled()
  })
  it('财务当前自定义权限撤销后，旧令牌和原操作重试也不能执行',async()=>{
    const f=fixture();await reclaimCatalog(f.prisma,request,7);const before=structuredClone(f.state())
    f.tx.sysUser.findUnique.mockResolvedValue({roleCode:'finance',status:1});f.tx.sysUserPermission.findMany.mockResolvedValue([{permCode:'inventory_query.adjust'}])
    await expect(reclaimCatalog(f.prisma,request,7)).rejects.toThrow('当前账号无收回退款权限')
    await expect(previewCatalogReclaim(f.prisma,request,7)).rejects.toThrow('当前账号无收回退款权限')
    expect(f.state()).toEqual(before)
  })
  it('当前有效财务使用独立默认退款权限执行，不依赖库存调整',async()=>{
    const f=fixture();f.tx.sysUser.findUnique.mockResolvedValue({roleCode:'finance',status:1})
    expect(await reclaimCatalog(f.prisma,request,7)).toMatchObject({refundAmount:1.25})
    expect(f.tx.sysRolePermission.findMany).toHaveBeenCalledWith({where:{roleCode:'finance'},select:{permCode:true}})
  })
})
