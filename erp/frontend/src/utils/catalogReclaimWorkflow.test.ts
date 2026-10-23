import { it, expect, vi, describe } from 'vitest'
import { reclaimRequestId, readReclaimAttempt, runReclaimAttempt, saveReclaimAttempt, type ReclaimAttempt } from './catalogReclaimWorkflow'
const storage=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}}}
const attempt:ReclaimAttempt={productName:'货盘商品',maxQty:2,payload:{clientRequestId:'97102566-c888-47eb-9eab-0ecdf141f941',customerCode:'TKL9001',sku:'TKL-A',quantity:1,allocations:[{orderId:21,quantity:1}],expectedRefundAmount:1.25}}
const result={clientRequestId:attempt.payload.clientRequestId,customerCode:'TKL9001',quantity:1,refundAmount:1.25}
describe('收回退款原请求恢复',()=>{
  it('提交前保存完整原购买分摊和退款金额，按账号隔离',()=>{
    const s=storage();saveReclaimAttempt(s,1,attempt);expect(readReclaimAttempt(s,2)).toBeNull();expect(readReclaimAttempt(s,1)).toEqual(attempt)
    expect(()=>saveReclaimAttempt(s,1,{...attempt,payload:{...attempt.payload,expectedRefundAmount:2.25}})).toThrow('勿更改数量')
  })
  it.each([401,403,409,500,0])('未知或需核对结果 %s 保留原分摊，精确重试不另建退款',async status=>{
    const s=storage(),api=vi.fn().mockRejectedValueOnce(Object.assign(new Error('failure'),{status})).mockResolvedValueOnce({...result,duplicate:true})
    await expect(runReclaimAttempt(api,s,1,attempt)).rejects.toThrow('原操作已保留')
    expect((await runReclaimAttempt(api,s,1,readReclaimAttempt(s,1)!)).completed).toBe(true)
    expect(api.mock.calls[0]).toEqual(api.mock.calls[1]);expect(readReclaimAttempt(s,1)).toBeNull()
  })
  it('收回退款已完成但同步失败时保留原请求',async()=>{
    const s=storage();expect((await runReclaimAttempt(async()=>({...result,syncPending:true}),s,1,attempt)).completed).toBe(false);expect(readReclaimAttempt(s,1)).toEqual(attempt)
  })
  it.each([400,404,422])('明确未执行 %s 后允许核对最新购买记录',async status=>{
    const s=storage();await expect(runReclaimAttempt(async()=>{throw {status}},s,1,attempt)).rejects.toThrow('本次未新增收回');expect(readReclaimAttempt(s,1)).toBeNull()
  })
  it.each([{customerCode:'OTHER'},{clientRequestId:'OTHER'},{refundAmount:99},{quantity:2}])('返回原单或退款金额不一致时保持待核对 %p',async change=>{
    const s=storage();await expect(runReclaimAttempt(async()=>({...result,...change}),s,1,attempt)).rejects.toThrow('原操作已保留');expect(readReclaimAttempt(s,1)).toEqual(attempt)
  })
  it('无法保存原操作时不发送会收回或退款的请求',async()=>{
    const s=storage(),api=vi.fn();s.setItem=()=>{throw Error('quota')}
    await expect(runReclaimAttempt(api,s,1,attempt)).rejects.toThrow('本次尚未提交');expect(api).not.toHaveBeenCalled()
  })
  it('请求标识符合后端UUID约束',()=>{
    const first=reclaimRequestId();expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);expect(reclaimRequestId()).not.toBe(first)
  })
})
