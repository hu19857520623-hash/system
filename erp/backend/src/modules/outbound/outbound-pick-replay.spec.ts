import { OutboundService } from './outbound.service'

function fixture() {
  const order:any={id:61n,outboundNo:'OB-61',warehouseCode:'WMS-JHB-01',status:'picking',pickerId:59n,items:[{id:32n,productId:694n,sku:'A',qty:1}]}
  let receipt:any=null,tail=Promise.resolve()
  const tx:any={
    $queryRaw:jest.fn().mockResolvedValue([]),
    operationLog:{findFirst:jest.fn(async()=>receipt),create:jest.fn(async({data}:any)=>{receipt=data;return data})},
    outboundOrder:{findUnique:jest.fn(async()=>structuredClone(order)),updateMany:jest.fn(async()=>{order.status='picked';return {count:1}})},
    warehouseLocation:{findFirst:jest.fn(async()=>({id:1n}))},outboundPickAllocation:{create:jest.fn()},outboundOrderItem:{update:jest.fn()},
  }
  const db:any={...tx,$transaction:(fn:any)=>{const result=tail.then(()=>fn(tx));tail=result.catch(()=>{});return result}}
  const mutation={deductLocationQtyFifo:jest.fn(async()=>[{inventoryLocationId:1n,qty:1}])}
  const service=new OutboundService(db,{} as any,{} as any,mutation as any,{} as any,{log:jest.fn()} as any)
  jest.spyOn(service,'detail').mockImplementation(async()=>({id:61,outboundNo:'OB-61',status:order.status}) as any)
  const payload={clientRequestId:'audit-pick-original',pickSource:'pick_list' as const,items:[{id:32,allocations:[{locationCode:'A-01',qty:1}]}]}
  return {service,tx,mutation,order,payload,setReceipt:(r:any)=>{receipt=r}}
}
describe('pick original receipt binding and serialized replay',()=>{
  it('concurrent identical requests deduct a bin and save allocations once; replay remains valid after shipping',async()=>{
    const f=fixture();const results=await Promise.all([f.service.pick(61,f.payload,59),f.service.pick(61,f.payload,59)])
    expect(results.filter(r=>(r as any).duplicate)).toHaveLength(1)
    expect(f.mutation.deductLocationQtyFifo).toHaveBeenCalledTimes(1)
    expect(f.tx.operationLog.create).toHaveBeenCalledTimes(1)
    f.order.status='shipped'
    await expect(f.service.pick(61,f.payload,59)).resolves.toMatchObject({duplicate:true,status:'shipped'})
    expect(f.mutation.deductLocationQtyFifo).toHaveBeenCalledTimes(1)
  })
  it.each([{targetId:'OTHER',operatorId:59n},{targetId:'OB-61',operatorId:51n}])('does not mistake another order or actor receipt as success %p',async identity=>{
    const f=fixture();f.setReceipt({...identity,detail:{clientRequestId:f.payload.clientRequestId}})
    await expect(f.service.pick(61,f.payload,59)).rejects.toThrow('其它账号或出库单')
    expect(f.mutation.deductLocationQtyFifo).not.toHaveBeenCalled()
  })
  it('changed quantities or bins cannot reuse the original receipt',async()=>{
    const f=fixture();await f.service.pick(61,f.payload,59)
    for(const allocations of [[{locationCode:'A-01',qty:2}],[{locationCode:'B-01',qty:1}]]) {
      await expect(f.service.pick(61,{...f.payload,items:[{id:32,allocations}]},59)).rejects.toThrow('不能更改')
    }
    expect(f.mutation.deductLocationQtyFifo).toHaveBeenCalledTimes(1)
  })
  it('old allocation receipts replay only their explicit original order/actor/content',async()=>{
    const f=fixture();f.order.status='shipped'
    f.setReceipt({targetId:'OB-61',operatorId:59n,detail:{clientRequestId:f.payload.clientRequestId,pickSource:'pick_list',allocations:[{sku:'A',locationCode:'A-01',qty:1}]}})
    await expect(f.service.pick(61,f.payload,59)).resolves.toMatchObject({duplicate:true,status:'shipped'})
    await expect(f.service.pick(61,{...f.payload,items:[]},59)).rejects.toThrow('不能更改')
    expect(f.mutation.deductLocationQtyFifo).not.toHaveBeenCalled()
  })
})
