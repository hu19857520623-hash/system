import { InboundService } from './inbound.service'
import { omsAsnRequestIdentity } from './oms-asn-request-identity.util'
function fixture(){
  const order:any={id:97n,omsCustomerCode:'TKL9069',warehouseCode:'WMS-JHB-01',items:[{productId:1n,sku:'TKL9069-A',expectedQty:3},{productId:2n,sku:'TKL9069-B',expectedQty:2}],cartons:[{boxSeq:1,items:[{sku:'TKL9069-A',qty:3}]},{boxSeq:2,items:[{sku:'TKL9069-B',qty:2}]}]}
  const db:any={customer:{findUnique:jest.fn(async()=>({status:1}))},warehouse:{findUnique:jest.fn(async()=>({warehouseType:'wms'}))},inboundOrder:{findUnique:jest.fn(async()=>order),create:jest.fn()},product:{findMany:jest.fn(async()=>[{sku:'TKL9069-A',customerSku:'A'},{sku:'TKL9069-B',customerSku:'B'}]),create:jest.fn()}}
  db.$transaction=jest.fn(async fn=>fn(db));db.$queryRaw=jest.fn(async()=>[]);db.$queryRawUnsafe=jest.fn(async()=>[])
  db.operationLog={findFirst:jest.fn(async()=>null)}
  const service=new InboundService(db,null as any,null as any,null as any,null as any,null as any)
  jest.spyOn(service as any,'mapInboundForOms').mockImplementation(()=>({id:97,status:'shelved'}))
  const body={inboundNo:'RVTKL9069-AUDIT81',customerCode:'TKL9069',items:[{sku:'TKL9069-A',qty:3,boxNo:1},{sku:'TKL9069-B',qty:2,boxNo:2}]}
  return{service,db,body}
}
describe('创建入库原明细重放',()=>{
  it('客户锁内发现已删除草稿单号时拒绝迟到提交，不创建订单或商品',async()=>{
    const f=fixture()
    f.db.$queryRaw.mockImplementation(async (sql:TemplateStringsArray)=>sql.join('?').includes('snapshot_tombstone')?[{entity_id:f.body.inboundNo}]:[])
    await expect(f.service.createAsnFromOms(f.body)).rejects.toThrow('入库草稿已删除')
    expect(f.db.inboundOrder.findUnique).not.toHaveBeenCalled();expect(f.db.product.create).not.toHaveBeenCalled()
  })
  it('新单读取持久化创建回执，预报变化时拒绝原请求重试且不写数据',async()=>{
    const f=fixture(),body={...f.body,contact:'原联系人',items:f.body.items.map(item=>({...item,lengthCm:20,widthCm:10,heightCm:5}))}
    f.db.operationLog.findFirst.mockResolvedValue({detail:{requestIdentityVersion:1,requestIdentity:omsAsnRequestIdentity(body,'WMS-JHB-01',body.items.map(item=>item.sku))}})
    await expect(f.service.createAsnFromOms(body)).resolves.toMatchObject({idempotent:true})
    await expect(f.service.createAsnFromOms({...body,contact:'另一联系人'})).rejects.toThrow('预报信息或客户尺寸与原请求不一致')
    await expect(f.service.createAsnFromOms({...body,items:body.items.map(item=>({...item,heightCm:6}))})).rejects.toThrow('预报信息或客户尺寸与原请求不一致')
    expect(f.db.inboundOrder.create).not.toHaveBeenCalled();expect(f.db.product.create).not.toHaveBeenCalled()
  })
  it('允许同客户原明细和客户SKU别名读取当前状态，不创建第二单',async()=>{
    const f=fixture();await expect(f.service.createAsnFromOms(f.body)).resolves.toMatchObject({idempotent:true,status:'shelved'})
    await expect(f.service.createAsnFromOms({...f.body,items:[{sku:'B',qty:2,boxNo:2},{sku:'A',qty:1,boxNo:1},{sku:'A',qty:2,boxNo:1}]})).resolves.toMatchObject({idempotent:true})
    expect(f.db.inboundOrder.create).not.toHaveBeenCalled();expect(f.db.product.create).not.toHaveBeenCalled()
  })
  it.each([[{sku:'TKL9069-A',qty:4,boxNo:1},{sku:'TKL9069-B',qty:2,boxNo:2}],[{sku:'OTHER',qty:3,boxNo:1},{sku:'TKL9069-B',qty:2,boxNo:2}],[{sku:'TKL9069-A',qty:3,boxNo:2},{sku:'TKL9069-B',qty:2,boxNo:1}]].map(items=>[items]))('不能用原单号改变数量、商品或箱号 %p',async items=>{
    const f=fixture();await expect(f.service.createAsnFromOms({...f.body,items})).rejects.toThrow('原商品、箱号、数量或仓库不一致')
    expect(f.db.inboundOrder.create).not.toHaveBeenCalled();expect(f.db.product.create).not.toHaveBeenCalled()
  })
})
