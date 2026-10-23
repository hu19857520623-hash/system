import { OutboundService } from './outbound.service'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { OmsOutboundItemDto } from './dto/oms-outbound.dto'
function fixture() {
  let order:any=null, quantity=4
  const customer={id:1n,customerCode:'TKL9001',customerName:'隔离客户',status:1,balance:100}
  const tx:any={$queryRaw:jest.fn().mockResolvedValue([]),customerSkuInventory:{findUnique:jest.fn(async()=>({id:4n,sku:'TKL-A',quantity})),updateMany:jest.fn(async({where,data})=>{if(quantity<where.quantity.gte)return {count:0};quantity-=data.quantity.decrement;return {count:1}})},outboundOrder:{findUnique:jest.fn(async()=>order)}}
  const prisma:any={customer:{findUnique:async()=>customer},product:{findUnique:jest.fn(async({where})=>where.sku==='A'?{id:2n,sku:'A',productName:'商品'}:null),findFirst:jest.fn().mockResolvedValue({id:2n,sku:'A',productName:'商品'})},customerSkuInventory:{findMany:jest.fn().mockResolvedValue([{id:4n,sku:'TKL-A',quantity:4}]),findUnique:jest.fn().mockResolvedValue({id:4n,quantity:4})},outboundOrder:{findUnique:jest.fn(async()=>order)},$transaction:jest.fn(async fn=>fn(tx))}
  const service=new OutboundService(prisma,{} as any,{} as any,{} as any,{} as any,{} as any)
  const create=jest.spyOn(service,'create').mockImplementation(async(data:any)=>{
    order={...data,id:7n,customerId:1n,status:'pending_pick',items:data.items.map(i=>({...i,productId:BigInt(i.productId)})),attachments:[],recipientJson:data.recipient?JSON.stringify(data.recipient):null,createdAt:new Date('2026-10-23'),updatedAt:new Date('2026-10-23')};return {id:7} as any
  })
  const body:any={outboundNo:'DOTKL9001-261023-0091',customerCode:'TKL9001',warehouseCode:'WMS-JHB-01',stockSource:'catalog',items:[{sku:'TKL-A',qty:1,needsRelabel:false},{sku:'A',qty:1,needsRelabel:false}]}
  return {service,prisma,tx,create,body}
}
describe('货盘持有与仓内SKU预约对应',()=>{
  it('别名解析仓内商品，但从原持有编码扣减；相同商品明细合并',async()=>{
    const f=fixture();await f.service.createFromOms(f.body)
    expect(f.create.mock.calls[0][0].items).toEqual([{productId:2,sku:'A',productName:'商品',qty:2,needsRelabel:false}])
    expect(f.tx.customerSkuInventory.findUnique).toHaveBeenCalledWith({where:{customerId_sku:{customerId:1n,sku:'TKL-A'}}})
    expect(f.tx.customerSkuInventory.updateMany).toHaveBeenCalledWith({where:{id:4n,quantity:{gte:2}},data:{quantity:{decrement:2}}})
  })
  it('预约原单重试能比较合并后的基础SKU，不重复锁库存或持有',async()=>{
    const f=fixture();await f.service.createFromOms(f.body);expect(await f.service.createFromOms(f.body)).toMatchObject({idempotent:true})
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);expect(f.tx.customerSkuInventory.updateMany).toHaveBeenCalledTimes(1)
  })
  it('原单收件信息按同一规则归一，空白和默认字段不导致重复预约误判',async()=>{
    const f=fixture();f.body.recipient={name:' 收件人 ',city:' City ',phone:'000',postalCode:' 0000 ',address1:' Isolated Street '}
    await f.service.createFromOms(f.body);expect(await f.service.createFromOms(f.body)).toMatchObject({idempotent:true})
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1)
  })
  it('客户私有库存不走货盘别名兜底',async()=>{
    const f=fixture();await expect(f.service.createFromOms({...f.body,stockSource:'owned'})).rejects.toThrow('不存在');expect(f.prisma.product.findFirst).not.toHaveBeenCalled()
  })
  it('多份持有编码不自动合并成两份发货权',async()=>{
    const f=fixture();f.prisma.customerSkuInventory.findMany.mockResolvedValue([{sku:'TKL-A',quantity:2},{sku:'A',quantity:2}])
    await expect(f.service.createFromOms(f.body)).rejects.toThrow('多份持有编码');expect(f.create).not.toHaveBeenCalled()
  })
  it('并发收回后持有已不足，条件扣减失败回滚预约',async()=>{
    const f=fixture();f.tx.customerSkuInventory.updateMany.mockResolvedValue({count:0})
    await expect(f.service.createFromOms(f.body)).rejects.toThrow('本次预约已回滚')
  })
  it.each([true,'1',1.5,0,-1])('预约数量 %p 不能被转换成有效库存数量',async qty=>{
    expect((await validate(plainToInstance(OmsOutboundItemDto,{sku:'A',qty}))).length).toBeGreaterThan(0)
    const f=fixture();await expect(f.service.createFromOms({...f.body,items:[{sku:'A',qty,needsRelabel:false}]})).rejects.toThrow('正整数')
  })
})
