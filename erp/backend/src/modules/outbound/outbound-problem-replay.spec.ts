import {OutboundService} from './outbound.service'

function fixture(){
  const order:any={id:1n,outboundNo:'OUT-1',status:'picking',problemRemark:null},logs:any[]=[]
  const tx:any={$queryRaw:jest.fn(),sysUser:{findUnique:jest.fn().mockResolvedValue({realName:'仓库验收员'})},operationLog:{findFirst:jest.fn(async({where})=>logs.find(x=>x.detail.clientRequestId===where.detail.equals)||null),create:jest.fn(async({data})=>{logs.push(data);return data})},outboundOrder:{findUnique:jest.fn(async()=>({...order})),update:jest.fn(async({data})=>Object.assign(order,data))}}
  let queue=Promise.resolve();const db:any={...tx,$transaction:jest.fn((fn:any)=>{const run=queue.then(()=>fn(tx));queue=run.catch(()=>{});return run})}
  const root={log:jest.fn()},service=new OutboundService(db,{}as any,{}as any,{}as any,{}as any,root as any),push=jest.spyOn(service as any,'pushOutboundStatusToOms').mockResolvedValue(true)
  jest.spyOn(service,'detail').mockImplementation(async()=>({...order,id:1})as any)
  const body={clientRequestId:'original-1',markType:'problem' as const,problemType:'stock_short',problemRemark:'缺少一件'}
  return{service,db,tx,order,logs,push,root,body}
}
describe('问题标记原请求和事务',()=>{
  it('相同原请求并发只改一次；后续状态变化后重放不覆盖当前状态',async()=>{
    const f=fixture();const results=await Promise.all([f.service.setProblem(1,f.body,21),f.service.setProblem(1,f.body,21)])
    expect(results.filter(x=>x.duplicate).length).toBe(1);expect(f.tx.outboundOrder.update).toHaveBeenCalledTimes(1);expect(f.tx.operationLog.create).toHaveBeenCalledTimes(1)
    f.order.status='shipped';await expect(f.service.setProblem(1,f.body,21)).resolves.toMatchObject({duplicate:true,status:'shipped'})
    expect(f.tx.outboundOrder.update).toHaveBeenCalledTimes(1)
  })
  it('同标识换出库单或改内容均拒绝，不误判为另一单成功',async()=>{
    const f=fixture();await f.service.setProblem(1,f.body,21)
    await expect(f.service.setProblem(2,f.body,21)).rejects.toThrow('出库单或内容不同')
    await expect(f.service.setProblem(1,{...f.body,problemRemark:'改成另外内容'},21)).rejects.toThrow('出库单或内容不同')
    expect(f.tx.outboundOrder.update).toHaveBeenCalledTimes(1);expect(f.logs).toHaveLength(1)
  })
  it('原操作标识不能换账号使用',async()=>{
    const f=fixture();await f.service.setProblem(1,f.body,21);await expect(f.service.setProblem(1,f.body,22)).rejects.toThrow('账号、出库单或内容不同')
    expect(f.logs.map(x=>x.operatorId)).toEqual([21n]);expect(f.tx.outboundOrder.update).toHaveBeenCalledTimes(1)
  })
  it('旧无指纹回执仍须匹配账号、原单和已记内容',async()=>{
    const f=fixture();f.logs.push({operatorId:21n,targetId:'OUT-1',detail:{clientRequestId:'original-1',markType:'problem',problemType:'stock_short',exceptionType:null,problemRemark:'缺少一件'}})
    await expect(f.service.setProblem(1,f.body,21)).resolves.toMatchObject({duplicate:true})
    await expect(f.service.setProblem(1,{...f.body,problemType:'damaged'},21)).rejects.toThrow('内容不同')
    expect(f.tx.outboundOrder.update).not.toHaveBeenCalled();expect(f.tx.operationLog.create).not.toHaveBeenCalled()
  })
  it('日志失败在业务事务内拒绝，不通知OMS或走root日志',async()=>{
    const f=fixture();f.tx.operationLog.create.mockRejectedValueOnce(new Error('标记日志失败'))
    await expect(f.service.setProblem(1,{...f.body,markType:'exception',exceptionType:'other'},21)).rejects.toThrow('标记日志失败')
    expect(f.push).not.toHaveBeenCalled();expect(f.root.log).not.toHaveBeenCalled()
  })
  it('OMS通知失败返回待同步，原请求重放重发当前状态而不再改标记',async()=>{
    const f=fixture();f.push.mockResolvedValueOnce(false)
    const body={...f.body,markType:'exception' as const,exceptionType:'other'}
    await expect(f.service.setProblem(1,body,21)).resolves.toMatchObject({syncPending:true})
    await expect(f.service.setProblem(1,body,21)).resolves.toMatchObject({duplicate:true})
    expect(f.push).toHaveBeenCalledTimes(2);expect(f.tx.outboundOrder.update).toHaveBeenCalledTimes(1);expect(f.logs).toHaveLength(1)
  })
  it.each([{clientRequestId:'a'.repeat(101)},{problemRemark:{}},{markType:4}])('无效原标识或标记文本先中文拒绝 %p',async bad=>{
    const f=fixture();await expect(f.service.setProblem(1,{...f.body,...bad}as any,21)).rejects.toThrow(/操作标识|有效文本/);expect(f.db.$transaction).not.toHaveBeenCalled()
  })
})
