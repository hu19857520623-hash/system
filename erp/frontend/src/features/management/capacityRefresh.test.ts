import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createCapacityRefresh } from './capacityRefresh'

const stops: (()=>void)[]=[]
afterEach(()=>stops.splice(0).forEach(stop=>stop()))
function fixture(values=new Map<string,string>()) {
  const owner=ref('31'), storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
  const send=vi.fn().mockResolvedValue({refreshed:2,scopeLabel:'甲仓'}), lookup=vi.fn().mockResolvedValue({found:false}), applied=vi.fn()
  const controller=createCapacityRefresh({owner:()=>owner.value,storage,send,lookup,applied,newId:()=> 'capacity-refresh-37'})
  stops.push(controller.stop);return {owner,storage,send,lookup,applied,controller,values}
}
describe('容量预警刷新恢复',()=>{
  it('double click submits once and uses the initially selected warehouse',async()=>{
    const f=fixture();let resolve!:(r:any)=>void
    f.send.mockReturnValue(new Promise(r=>{resolve=r}))
    const first=f.controller.start('A');await f.controller.start('B')
    expect(f.send).toHaveBeenCalledTimes(1);expect(f.send).toHaveBeenCalledWith(expect.objectContaining({warehouseCode:'A'}))
    resolve({refreshed:2,scopeLabel:'甲仓'});await first;expect(f.controller.pending.value).toBeNull();expect(f.controller.feedback.value).toContain('甲仓')
  })
  it('lost response survives reload and recovers the committed result without posting again',async()=>{
    const first=fixture();first.send.mockRejectedValue(new TypeError('Failed to fetch'));await first.controller.start('A');first.controller.stop()
    const f=fixture(first.values);expect(f.controller.pending.value).toMatchObject({warehouseCode:'A',requestId:'capacity-refresh-37',uncertain:true})
    f.lookup.mockResolvedValue({found:true,result:{refreshed:3,scopeLabel:'甲仓'}});await f.controller.reconcile()
    expect(f.send).not.toHaveBeenCalled();expect(f.applied).toHaveBeenCalledWith({refreshed:3,scopeLabel:'甲仓'});expect(f.values.size).toBe(0)
  })
  it('not found and lookup failure retain the original request; retry does not expand to all warehouses',async()=>{
    const f=fixture();f.send.mockRejectedValue(new Error('Bad Gateway'));await f.controller.start('A');await f.controller.reconcile()
    expect(f.controller.feedback.value).toContain('重试原刷新')
    f.lookup.mockRejectedValue(new TypeError('Failed to fetch'));await f.controller.reconcile();expect(f.controller.feedback.value).toContain('核对刷新结果失败')
    f.send.mockResolvedValue({refreshed:1,scopeLabel:'甲仓'});await f.controller.retry()
    expect(f.send.mock.calls[1][0]).toMatchObject({warehouseCode:'A',requestId:'capacity-refresh-37'})
  })
  it('does not lose an uncertain request after a later permission denial',async()=>{
    const f=fixture();f.send.mockRejectedValue(new TypeError('Failed to fetch'));await f.controller.start()
    f.send.mockRejectedValue(Object.assign(new Error('Forbidden'),{status:403}));await f.controller.retry()
    expect(f.controller.pending.value).not.toBeNull();expect(f.controller.feedback.value).not.toContain('Forbidden')
  })
  it('a definite initial rejection permits correction; storage failure never sends',async()=>{
    const f=fixture();f.send.mockRejectedValue(Object.assign(new Error('所选海外仓不存在'),{status:400}));await f.controller.start('A')
    expect(f.controller.pending.value).toBeNull();expect(f.controller.feedback.value).toContain('所选海外仓不存在')
    f.send.mockClear();vi.spyOn(f.storage,'setItem').mockImplementation(()=>{throw new Error('QuotaExceeded')});await f.controller.start('B')
    expect(f.send).not.toHaveBeenCalled();expect(f.controller.feedback.value).toContain('本次尚未提交')
  })
  it('late results from another account cannot clear or apply this account state',async()=>{
    const f=fixture();let resolve!:(v:any)=>void;f.send.mockReturnValue(new Promise(r=>{resolve=r}))
    const first=f.controller.start('A');f.owner.value='32';await nextTick();resolve({refreshed:2,scopeLabel:'甲仓'});await first
    expect(f.applied).not.toHaveBeenCalled();expect(f.values.has('erp.capacity.refresh.31')).toBe(true);expect(f.controller.pending.value).toBeNull()
  })
  it('render failure after success never reports the mutation as uncommitted',async()=>{
    const f=fixture();f.applied.mockImplementation(()=>{throw new Error('render')});await f.controller.start('A')
    expect(f.controller.pending.value).toBeNull();expect(f.controller.feedback.value).toContain('预警已刷新');expect(f.controller.feedback.value).not.toContain('尚未确认')
  })
})
