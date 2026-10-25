import { setCatalogVisibility } from './catalog-visibility.util'
const request={visibleStockQty:8,expectedVisibleStockQty:2,expectedReceivedGoodQty:8}
function fixture(){
  let state:any={row:{id:1n,sku:'TKL-A',pricingStatus:'synced',visibleStockQty:2,soldQty:1,orderableOnOms:true},histories:[],received:8}
  const tx:any={$queryRaw:jest.fn().mockResolvedValue([]),sysUser:{findUnique:jest.fn().mockResolvedValue({status:1,roleCode:'admin',realName:'操作员'})},sysUserPermission:{findMany:jest.fn().mockResolvedValue([])},sysRolePermission:{findMany:jest.fn().mockResolvedValue([])},
    productPricing:{findUnique:jest.fn(async()=>state.row),update:jest.fn(async({data})=>Object.assign(state.row,data))},
    productPricingHistory:{create:jest.fn(async({data})=>{state.histories.push(data)})},
    inboundOrder:{findMany:jest.fn(async()=>[{inboundNo:'R1',status:'completed',sourceWarehouseCode:'CN',items:[{sku:'A',actualQty:state.received,qcStatus:'pass'}]}])},product:{findMany:jest.fn().mockResolvedValue([{id:1n,sku:'A'}])},
    customer:{update:jest.fn()},inventory:{update:jest.fn()},customerSkuInventory:{updateMany:jest.fn()}}
  const prisma={$transaction:jest.fn(async(work:any)=>{const before=structuredClone(state);try{return await work(tx)}catch(e){state=before;throw e}})}
  return {tx,prisma,state:()=>state}
}
describe('总可见额度有界设置与原设置重试',()=>{
  it('设置累计范围内额度，已售单独扣除，重复目标不重复写历史',async()=>{
    const f=fixture();expect(await setCatalogVisibility(f.prisma,1,request,7)).toMatchObject({visibleStockQty:8,receivedGoodQty:8,catalogStockPool:8,remainingStockQty:7,duplicate:false})
    expect(await setCatalogVisibility(f.prisma,1,request,7)).toMatchObject({duplicate:true})
    expect(f.state().histories).toHaveLength(1);expect(f.tx.customer.update).not.toHaveBeenCalled();expect(f.tx.inventory.update).not.toHaveBeenCalled();expect(f.tx.customerSkuInventory.updateMany).not.toHaveBeenCalled()
  })
  it('保留较低运营额度，设零时关闭新申购但不修改已售或持有',async()=>{
    const f=fixture();expect(await setCatalogVisibility(f.prisma,1,{...request,visibleStockQty:0},7)).toMatchObject({remainingStockQty:0,soldQty:1})
    expect(f.state().row).toMatchObject({visibleStockQty:0,orderableOnOms:false,soldQty:1})
  })
  it('超过实收上限或读取后实收变化时拒绝，不能纳入在途',async()=>{
    const f=fixture();await expect(setCatalogVisibility(f.prisma,1,{...request,visibleStockQty:9},7)).rejects.toThrow('累计良品实收 8')
    f.state().received=6;await expect(setCatalogVisibility(f.prisma,1,request,7)).rejects.toThrow('累计良品实收已变化');expect(f.state().histories).toHaveLength(0)
  })
  it('并发其它操作改过额度后不覆盖，需重新读取版本',async()=>{
    const f=fixture();f.state().row.visibleStockQty=3
    await expect(setCatalogVisibility(f.prisma,1,request,7)).rejects.toThrow('其它操作修改');expect(f.state().row.visibleStockQty).toBe(3)
  })
  it('历史写入失败时额度也回滚，原设置可重试',async()=>{
    const f=fixture();f.tx.productPricingHistory.create.mockRejectedValueOnce(new Error('history fault'))
    await expect(setCatalogVisibility(f.prisma,1,request,7)).rejects.toThrow('history fault');expect(f.state().row.visibleStockQty).toBe(2)
    expect(await setCatalogVisibility(f.prisma,1,request,7)).toMatchObject({visibleStockQty:8})
  })
  it.each([true,'8',1.5,-1,Infinity])('无效额度%s不进入事务',async visibleStockQty=>{
    const f=fixture();await expect(setCatalogVisibility(f.prisma,1,{...request,visibleStockQty} as any,7)).rejects.toThrow('非负整数');expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })
  it('当前财务或停用账号不因旧令牌得到定价修改能力',async()=>{
    const f=fixture();f.tx.sysUser.findUnique.mockResolvedValue({status:1,roleCode:'finance'})
    await expect(setCatalogVisibility(f.prisma,1,request,7)).rejects.toThrow('无调整货盘额度权限')
    f.tx.sysUser.findUnique.mockResolvedValue({status:0,roleCode:'admin'});await expect(setCatalogVisibility(f.prisma,1,request,7)).rejects.toThrow('无调整货盘额度权限')
  })
})
