import {describe,it,expect,vi} from 'vitest'
import {ref} from 'vue'
import {savePickAttempt,operatePickAttempt,type PickAttempt} from './outboundPicking'
import {savePackAttempt,operatePackAttempt,type PackAttempt} from './outboundPacking'
import {saveAssignment,operateAssignment,type AssignmentAttempt} from './outboundAssignment'
function storage(){const rows=new Map<string,string>();return {getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v)},removeItem:(k:string)=>{rows.delete(k)}}}
describe('Vue弹窗中保存的原请求可提交',()=>{
  it('ref恢复的拣货请求可以提交，不因代理对象复制失败',async()=>{
    const original=ref<PickAttempt>({outboundId:63,outboundNo:'OB-63',order:{id:63,outboundNo:'OB-63'},payload:{clientRequestId:'pick-reactive',pickSource:'pick_list',items:[{id:1,allocations:[{locationCode:'A-01',qty:1}]}]}}).value
    const s=storage();savePickAttempt(s,59,original)
    const reply=(outcome:string)=>({id:63,outboundNo:'OB-63',requestId:'pick-reactive',outcome})
    const api={pickRequest:vi.fn().mockResolvedValueOnce(reply('unknown')).mockResolvedValue(reply('confirmed')),pick:vi.fn().mockResolvedValue({})}
    await expect(operatePickAttempt(api,s,59,original,'retry',()=>{})).resolves.toMatchObject({outcome:'confirmed'})
    expect(api.pick).toHaveBeenCalledWith(63,JSON.parse(JSON.stringify(original.payload)))
  })
  it('ref恢复的实测复核请求可以提交',async()=>{
    const original=ref<PackAttempt>({outboundId:63,outboundNo:'OB-63',order:{id:63,outboundNo:'OB-63'},payload:{clientRequestId:'pack-reactive',reviewSource:'pick_list',isPalletized:false,palletInfo:'',cartons:[{lengthCm:30,widthCm:20,heightCm:10,grossWeightKg:2}]}}).value
    const s=storage();savePackAttempt(s,61,original)
    const reply=(outcome:string)=>({id:63,outboundNo:'OB-63',requestId:'pack-reactive',outcome})
    const api={packRequest:vi.fn().mockResolvedValueOnce(reply('unknown')).mockResolvedValue(reply('confirmed')),pack:vi.fn().mockResolvedValue({})}
    await expect(operatePackAttempt(api,s,61,original,'retry',()=>{})).resolves.toMatchObject({outcome:'confirmed'})
    expect(api.pack).toHaveBeenCalledWith(63,JSON.parse(JSON.stringify(original.payload)))
  })
  it.each(['retry','cancel'] as const)('ref恢复的批量分配资料支持%s',async mode=>{
    const original=ref<AssignmentAttempt>({pickerName:'拣货员',orderNos:['OB-63'],payload:{clientRequestId:'assignment-reactive',ids:[63],pickerId:59,expectedOrders:[{id:63,status:'pending_pick',pickerId:null}]}}).value
    const s=storage();saveAssignment(s,59,original)
    const reply=(outcome:string)=>({requestId:'assignment-reactive',outcome,ids:[63],pickerId:59})
    const api={assignmentRequest:vi.fn().mockResolvedValueOnce(reply('unknown')).mockResolvedValue(reply('confirmed')),assignPicker:vi.fn().mockResolvedValue({}),cancelAssignment:vi.fn().mockResolvedValue(reply('cancelled'))}
    await expect(operateAssignment(api,s,59,original,mode,()=>{})).resolves.toMatchObject({outcome:mode==='retry'?'confirmed':'cancelled'})
    expect(mode==='retry'?api.assignPicker:api.cancelAssignment).toHaveBeenCalledWith(JSON.parse(JSON.stringify(original.payload)))
  })
})
