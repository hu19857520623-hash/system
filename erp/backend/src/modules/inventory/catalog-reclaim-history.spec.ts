import { catalogReclaimHistory, catalogReclaimSyncReceipt } from './catalog-reclaim-history.util'
import { readCatalogRefunds } from '../billing/catalog-refund-ledger.util'
jest.mock('../billing/catalog-refund-ledger.util', () => ({ readCatalogRefunds: jest.fn() }))

function fixture() {
  const row:any = { id:31n, operatorId:7n, createdAt:new Date('2026-10-23'), detail:{ customerId:1, refundVersion:1, refund:{balanceBefore:'8.00',balanceAfter:'10.00'}, request:{remark:'原退款'}, response:{referenceNo:'RCL-'+'a'.repeat(32),customerCode:'TKL9001',sku:'TKL-A',quantity:1,refundAmount:2,clientRequestId:'original'} } }
  const customer={id:1n,customerCode:'TKL9001',customerName:'隔离客户',balance:10}
  const tx:any={sysUser:{findUnique:jest.fn().mockResolvedValue({roleCode:'admin',status:1}),findMany:jest.fn().mockResolvedValue([{id:7n,realName:'原财务'}])},
    sysUserPermission:{findMany:jest.fn().mockResolvedValue([])},sysRolePermission:{findMany:jest.fn().mockResolvedValue([])},
    operationLog:{findMany:jest.fn().mockResolvedValue([row]),count:jest.fn().mockResolvedValue(201),findFirst:jest.fn().mockResolvedValue(row)},customer:{findUnique:jest.fn().mockResolvedValue(customer),update:jest.fn()},
    customerSkuInventory:{updateMany:jest.fn(),create:jest.fn()},productPricing:{updateMany:jest.fn()}}
  const prisma={$transaction:jest.fn(async(work:any)=>work(tx))}
  ;(readCatalogRefunds as jest.Mock).mockResolvedValue([{referenceNo:row.detail.response.referenceNo,amount:2,allocations:[{orderId:9,orderNo:'CAT-ORIGINAL',quantity:1,unitCents:200,amountCents:200}]}])
  return {prisma,tx,row}
}
describe('退款记录与仅补同步恢复',()=>{
  beforeEach(()=>jest.resetAllMocks())
  it('持有归零后仍从已保存回执读取原单、原价及当时余额，不依赖持有行',async()=>{
    const f=fixture(),result=await catalogReclaimHistory(f.prisma,{page:2,pageSize:100},7)
    expect(result.total).toBe(201)
    expect(result.items[0]).toMatchObject({id:31,customerCode:'TKL9001',sku:'TKL-A',amount:2,balanceBefore:8,balanceAfter:10,operatorName:'原财务',canRetrySync:true,allocations:[{orderNo:'CAT-ORIGINAL',unitPrice:2,quantity:1,amount:2}]})
    expect(f.tx.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({skip:100,take:100}))
    expect(f.tx.customerSkuInventory.updateMany).not.toHaveBeenCalled();expect(f.tx.customer.update).not.toHaveBeenCalled()
  })
  it('总数和分页使用同一个客户、商品别名及退款版本范围',async()=>{
    const f=fixture();await catalogReclaimHistory(f.prisma,{customerCode:' TKL9001 ',sku:'A'},7)
    const where=f.tx.operationLog.findMany.mock.calls[0][0].where
    expect(f.tx.operationLog.count).toHaveBeenCalledWith({where})
    expect(where.AND).toEqual(expect.arrayContaining([{detail:{path:'$.refundVersion',equals:1}},{detail:{path:'$.response.customerCode',equals:'TKL9001'}}]))
    expect(where.AND[2].OR).toEqual(expect.arrayContaining([{detail:{path:'$.response.sku',equals:'A'}},{detail:{path:'$.response.sku',equals:'TKL-A'}}]))
  })
  it('无记录正常返回，缺失历史操作人有可读替代，不输出英文状态',async()=>{
    const f=fixture();f.tx.sysUser.findMany.mockResolvedValue([])
    expect((await catalogReclaimHistory(f.prisma,{},8)).items[0]).toMatchObject({operatorName:'历史账号（7）',canRetrySync:false})
    f.tx.operationLog.findMany.mockResolvedValue([]);f.tx.operationLog.count.mockResolvedValue(0)
    expect(await catalogReclaimHistory(f.prisma,{},7)).toMatchObject({items:[],total:0})
  })
  it('历史付款或退款依据不完整时给出错误，不展示部分可信列表',async()=>{
    const f=fixture();(readCatalogRefunds as jest.Mock).mockRejectedValue(new Error('历史货盘退款回执不完整'))
    await expect(catalogReclaimHistory(f.prisma,{},7)).rejects.toThrow('退款回执不完整')
  })
  it('只读原回执用于补同步，多次调用也不碰余额、持有和已售',async()=>{
    const f=fixture()
    for(let i=0;i<2;i++)expect(await catalogReclaimSyncReceipt(f.prisma,31,7)).toMatchObject({duplicate:true,refundAmount:2,referenceNo:f.row.detail.response.referenceNo})
    expect(f.tx.customer.update).not.toHaveBeenCalled();expect(f.tx.customerSkuInventory.updateMany).not.toHaveBeenCalled();expect(f.tx.productPricing.updateMany).not.toHaveBeenCalled()
  })
  it('不同账号不能通过原回执补同步，缺失记录也不会新建退款',async()=>{
    const f=fixture();await expect(catalogReclaimSyncReceipt(f.prisma,31,8)).rejects.toThrow('原收回账号')
    f.tx.operationLog.findFirst.mockResolvedValue(null);await expect(catalogReclaimSyncReceipt(f.prisma,31,7)).rejects.toThrow('原退款回执不存在')
    expect(f.tx.customer.update).not.toHaveBeenCalled()
  })
  it('篡改或无法验证的回执不用于补同步',async()=>{
    const f=fixture();(readCatalogRefunds as jest.Mock).mockResolvedValue([])
    await expect(catalogReclaimSyncReceipt(f.prisma,31,7)).rejects.toThrow('退款回执依据不完整')
    f.row.detail.customerId=0;await expect(catalogReclaimHistory(f.prisma,{},7)).rejects.toThrow('缺少客户依据')
  })
  it.each([{roleCode:'viewer',status:1},{roleCode:'finance',status:0},null])('当前岗位或状态已变化时拒绝记录读取和补同步 %p',async user=>{
    const f=fixture();f.tx.sysUser.findUnique.mockResolvedValue(user)
    await expect(catalogReclaimHistory(f.prisma,{},7)).rejects.toThrow('仅当前财务')
    await expect(catalogReclaimSyncReceipt(f.prisma,31,7)).rejects.toThrow('仅当前财务')
    expect(f.tx.operationLog.findFirst).not.toHaveBeenCalled()
  })
})
