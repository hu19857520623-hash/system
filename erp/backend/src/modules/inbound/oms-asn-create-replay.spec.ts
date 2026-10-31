import { InboundService } from './inbound.service'
function fixture(){
  const order:any={id:97n,omsCustomerCode:'TKL9069',warehouseCode:'WMS-JHB-01',items:[{productId:1n,sku:'TKL9069-A',expectedQty:3},{productId:2n,sku:'TKL9069-B',expectedQty:2}],cartons:[{boxSeq:1,items:[{sku:'TKL9069-A',qty:3}]},{boxSeq:2,items:[{sku:'TKL9069-B',qty:2}]}]}
  const db:any={customer:{findUnique:jest.fn(async()=>({status:1}))},warehouse:{findUnique:jest.fn(async()=>({warehouseType:'wms'}))},inboundOrder:{findUnique:jest.fn(async()=>order),create:jest.fn()},product:{findMany:jest.fn(async()=>[{sku:'TKL9069-A',customerSku:'A'},{sku:'TKL9069-B',customerSku:'B'}]),create:jest.fn()}}
  const service=new InboundService(db,null as any,null as any,null as any,null as any,null as any)
  jest.spyOn(service as any,'mapInboundForOms').mockImplementation(()=>({id:97,status:'shelved'}))
  const body={inboundNo:'RVTKL9069-AUDIT81',customerCode:'TKL9069',items:[{sku:'TKL9069-A',qty:3,boxNo:1},{sku:'TKL9069-B',qty:2,boxNo:2}]}
  return{service,db,body}
}
describe('创建入库原明细重放',()=>{
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
