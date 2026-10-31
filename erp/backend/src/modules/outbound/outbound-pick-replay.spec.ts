import { OutboundService } from './outbound.service'

function fixture() {
  const order:any={id:61n,outboundNo:'OB-61',warehouseCode:'WMS-JHB-01',status:'picking',pickerId:59n,items:[{id:32n,productId:694n,sku:'A',qty:1}]}
  let receipt:any=null,tail=Promise.resolve()
  const tx:any={
    $queryRaw:jest.fn().mockResolvedValue([]),
    sysUser:{findUnique:jest.fn(async()=>({realName:'测试拣货员',username:'test_picker'}))},
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
  it('read-only lookup does not claim success from the current order status',async()=>{
    const f=fixture();f.order.status='shipped'
    await expect(f.service.pickRequest(61,'unknown-original',59)).resolves.toMatchObject({outcome:'unknown',currentStatus:'shipped'})
    expect(f.tx.operationLog.create).not.toHaveBeenCalled()
  })
  it('cancel wins before a delayed pick, remains readable, and cannot be reused by another actor',async()=>{
    const f=fixture()
    await expect(f.service.cancelPickRequest(61,f.payload.clientRequestId,59)).resolves.toMatchObject({outcome:'cancelled',currentStatus:'picking'})
    await expect(f.service.pick(61,f.payload,59)).rejects.toThrow('已取消')
    await expect(f.service.pickRequest(61,f.payload.clientRequestId,59)).resolves.toMatchObject({outcome:'cancelled'})
    await expect(f.service.cancelPickRequest(61,f.payload.clientRequestId,51)).rejects.toThrow('其它账号或出库单')
    expect(f.mutation.deductLocationQtyFifo).not.toHaveBeenCalled()
    expect(f.tx.operationLog.create).toHaveBeenCalledTimes(1)
  })
  it('concurrent pick and cancellation resolve to the committed pick without reversing allocations',async()=>{
    const f=fixture()
    let entered!:()=>void,release!:()=>void
    const inTransaction=new Promise<void>(resolve=>{entered=resolve}),continuePick=new Promise<void>(resolve=>{release=resolve})
    f.mutation.deductLocationQtyFifo.mockImplementationOnce(async()=>{entered();await continuePick;return [{inventoryLocationId:1n,qty:1}]})
    const picking=f.service.pick(61,f.payload,59)
    await inTransaction
    const cancelling=f.service.cancelPickRequest(61,f.payload.clientRequestId,59)
    release();await Promise.all([picking,cancelling])
    f.order.status='shipped'
    await expect(f.service.cancelPickRequest(61,f.payload.clientRequestId,59)).resolves.toMatchObject({outcome:'confirmed',currentStatus:'shipped'})
    await expect(f.service.pickRequest(61,f.payload.clientRequestId,59)).resolves.toMatchObject({outcome:'confirmed'})
    expect(f.mutation.deductLocationQtyFifo).toHaveBeenCalledTimes(1)
    expect(f.tx.operationLog.create).toHaveBeenCalledTimes(1)
  })
  it('a cancellation receipt cannot resolve another order or be overwritten by that order',async()=>{
    const f=fixture();f.setReceipt({action:'pick_cancel',targetId:'OTHER',operatorId:59n,detail:{clientRequestId:f.payload.clientRequestId}})
    await expect(f.service.pickRequest(61,f.payload.clientRequestId,59)).rejects.toThrow('其它账号或出库单')
    await expect(f.service.cancelPickRequest(61,f.payload.clientRequestId,59)).rejects.toThrow('其它账号或出库单')
    expect(f.tx.operationLog.create).not.toHaveBeenCalled()
  })
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
