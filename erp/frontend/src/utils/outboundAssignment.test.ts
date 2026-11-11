import {describe,it,expect,vi} from 'vitest'
import {readAssignment,saveAssignment,operateAssignment,withAssignmentLock,type AssignmentAttempt} from './outboundAssignment'
const original:AssignmentAttempt={pickerName:'拣货员A',orderNos:['OB-63','OB-64'],payload:{clientRequestId:'original-assignment',ids:[63,64],pickerId:59,expectedOrders:[{id:63,status:'pending_pick',pickerId:null},{id:64,status:'pending_pick',pickerId:null}]}}
function storage(){const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v)},removeItem:(k:string)=>{rows.delete(k)}}}
const receipt=(outcome:string)=>({requestId:original.payload.clientRequestId,outcome,ids:[64,63],pickerId:59,orders:[{id:63,outboundNo:'OB-63',status:'shipped',pickerId:55}]})
describe('原分配批次恢复',()=>{
  it('原账号保存后可重载，不能覆盖或另建其它批次',()=>{
    const s=storage();saveAssignment(s,59,original);expect(readAssignment(s,59)).toEqual(original);expect(readAssignment(s,51)).toBeNull()
    expect(()=>saveAssignment(s,59,{...original,payload:{...original.payload,pickerId:55}})).toThrow('不能另建或覆盖')
  })
  it('无法保存或存储损坏时不进入提交',()=>{
    expect(()=>saveAssignment({...storage(),setItem:()=>{throw new Error('quota')}},59,original)).toThrow('本次尚未提交')
    const s=storage();s.setItem('erp:outbound-assignment:59','bad');expect(()=>readAssignment(s,59)).toThrow('无法读取')
  })
  it('响应丢失后刷新只查原回执，不再次改派',async()=>{
    const s=storage();saveAssignment(s,59,original)
    const api={assignmentRequest:vi.fn().mockResolvedValueOnce(receipt('unknown')).mockResolvedValue(receipt('confirmed')),assignPicker:vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))}
    await expect(operateAssignment(api,s,59,original,'retry',()=>{})).rejects.toThrow('仍需核对')
    const restored=readAssignment(s,59)!
    await expect(operateAssignment(api,s,59,restored,'retry',()=>{})).resolves.toMatchObject({outcome:'confirmed',orders:[{pickerId:55}]})
    expect(api.assignPicker).toHaveBeenCalledExactlyOnceWith(original.payload);expect(readAssignment(s,59)).toBeNull()
  })
  it.each([400,401,403,409,422,429,500,503])('HTTP%s保留原资料，冲突也可查询和取消',async status=>{
    const s=storage();saveAssignment(s,59,original)
    await expect(operateAssignment({assignmentRequest:vi.fn().mockRejectedValue({status,message:'Forbidden'})},s,59,original,'check',()=>{})).rejects.toThrow(/原.*请求.*保留|原分配请求仍需核对/)
    expect(readAssignment(s,59)).toEqual(original)
  })
  it.each(['confirmed','cancelled'])('取消只按原结果%s清理，不修改后续分配',async outcome=>{
    const s=storage();saveAssignment(s,59,original);const api={cancelAssignment:vi.fn().mockResolvedValue(receipt(outcome)),assignPicker:vi.fn()}
    await expect(operateAssignment(api,s,59,original,'cancel',()=>{})).resolves.toMatchObject({outcome});expect(api.cancelAssignment).toHaveBeenCalledWith(original.payload);expect(api.assignPicker).not.toHaveBeenCalled();expect(readAssignment(s,59)).toBeNull()
  })
  it('账号、权限或离页变化后不提交也不清记录',async()=>{
    const s=storage();saveAssignment(s,59,original);let live=true
    const api={assignmentRequest:vi.fn(async()=>{live=false;return receipt('unknown')}),assignPicker:vi.fn()}
    await expect(operateAssignment(api,s,59,original,'retry',()=>{if(!live)throw new Error('身份已变化')})).rejects.toThrow('身份已变化')
    expect(api.assignPicker).not.toHaveBeenCalled();expect(readAssignment(s,59)).toEqual(original)
  })
  it('其它批次回执、本机原资料替换均不能清理原记录',async()=>{
    const s=storage();saveAssignment(s,59,original)
    await expect(operateAssignment({assignmentRequest:vi.fn().mockResolvedValue({...receipt('confirmed'),ids:[63]})},s,59,original,'check',()=>{})).rejects.toThrow('批次或人员无法核对')
    await expect(operateAssignment({},s,59,{...original,payload:{...original.payload,pickerId:55}},'retry',()=>{})).rejects.toThrow('本机原分配资料已变化')
    expect(readAssignment(s,59)).toEqual(original)
  })
  it('清理存储失败仍可再次查询原结果',async()=>{
    const s=storage();saveAssignment(s,59,original);const api={assignmentRequest:vi.fn().mockResolvedValue(receipt('confirmed'))}
    await expect(operateAssignment(api,{...s,removeItem:()=>{throw new Error('storage blocked')}},59,original,'check',()=>{})).rejects.toThrow('未能清除')
    expect(readAssignment(s,59)).toEqual(original)
  })
  it('其它页面持有账号锁时不执行新提交',async()=>{
    vi.stubGlobal('navigator',{locks:{request:async(_k:unknown,_o:unknown,fn:(lock:null)=>unknown)=>fn(null)}});const fn=vi.fn()
    try{await expect(withAssignmentLock(59,fn)).rejects.toThrow('另一个页面');expect(fn).not.toHaveBeenCalled()}finally{vi.unstubAllGlobals()}
  })
})
