import { InboundService } from './inbound.service'
describe('创建入库单重放客户隔离',()=>{
  it('同号另一客户或未知归属单据不能返回详情，也不能补写商品',async()=>{
    for(const owner of ['TKL9001',null]){
      const db:any={customer:{findUnique:jest.fn(async()=>({status:1}))},warehouse:{findUnique:jest.fn(async()=>({warehouseType:'wms'}))},inboundOrder:{findUnique:jest.fn(async()=>({id:71n,omsCustomerCode:owner})),create:jest.fn()},product:{create:jest.fn()}}
      const service=new InboundService(db,null as any,null as any,null as any,null as any,null as any)
      await expect(service.createAsnFromOms({inboundNo:'RVTKL9001-261016-9001',customerCode:'TKL9069',items:[{sku:'NEW',qty:1}]})).rejects.toThrow('当前客户的入库单不存在')
      expect(db.inboundOrder.findUnique).toHaveBeenCalledTimes(1);expect(db.product.create).not.toHaveBeenCalled();expect(db.inboundOrder.create).not.toHaveBeenCalled()
    }
  })
})
