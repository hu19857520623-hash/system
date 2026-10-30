import {effectScope,ref} from 'vue'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {useRepriceAttempt} from './repriceAttempt'
const stops:(()=>void)[]=[]
afterEach(()=>{stops.splice(0).forEach(fn=>fn());vi.restoreAllMocks()})
function fixture(){
 const rows=new Map<string,string>(),storage={getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v)},removeItem:(k:string)=>{rows.delete(k)}}
 const owner=ref<string|null>('scope7'),actor=ref('7'),request=vi.fn(),applied=vi.fn(async()=>{}),scope=effectScope()
 const control=scope.run(()=>useRepriceAttempt({actor:()=>actor.value,scope:()=>owner.value,storage,request,applied}))!
 stops.push(()=>scope.stop());return {...control,rows,storage,owner,actor,request,applied}
}
const payload={price:20,marketPrice:30,expectedUpdatedAt:'2026-10-30T00:00:00.000Z'}
const confirmed=(id:string)=>({requestId:id,status:'confirmed',pricingId:9,price:20,version:'2026-10-30T00:00:01.000Z',syncStatus:'recorded'})
describe('调价原请求恢复',()=>{
 it('缺少有效版本或售价时不生成无法恢复的原单',async()=>{const f=fixture();for(const invalid of [{...payload,expectedUpdatedAt:''},{...payload,price:0}]){expect(await f.start(9,'商品',invalid)).toBe(false);expect(f.rows.size).toBe(0)}expect(f.request).not.toHaveBeenCalled();expect(f.feedback.value).toContain('本次尚未提交')})
 it('提交前持久化原内容，英文失败转中文并保留；再次开始不能覆盖原请求',async()=>{
  const f=fixture();f.request.mockImplementation(async(_mode,a)=>{expect(JSON.parse([...f.rows.values()][0]).requestId).toBe(a.requestId);expect(a.payload).toEqual(payload);throw Error('NetworkError')})
  expect(await f.start(9,'原商品',payload)).toBe(false);const a=f.pending.value!
  expect(f.feedback.value).toContain('原调价已保留');expect(f.feedback.value).not.toContain('NetworkError')
  await f.start(10,'替换',{...payload,price:99});expect(f.request).toHaveBeenCalledOnce();expect(f.pending.value).toEqual(a)
 })
 it('刷新身份范围后恢复同账号原内容，核对确认先读取当前资料再清除',async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(Error('fetch'));await f.start(9,'商品',payload);const id=f.pending.value!.requestId
  f.owner.value='new token same actor';expect(f.pending.value!.requestId).toBe(id)
  f.request.mockResolvedValueOnce(confirmed(id));expect(await f.run('check')).toBe(true);expect(f.applied).toHaveBeenCalledOnce();expect(f.pending.value).toBeNull();expect(f.rows.size).toBe(0)
 })
 it('未知结果仍保留，取消必须收到原请求的取消回执',async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(Error('fetch'));await f.start(9,'商品',payload);const id=f.pending.value!.requestId
  f.request.mockResolvedValueOnce({requestId:id,status:'unknown',pricingId:9});expect(await f.run('check')).toBe(false);expect(f.pending.value).not.toBeNull()
  f.request.mockResolvedValueOnce({requestId:id,status:'cancelled',pricingId:9});expect(await f.run('cancel')).toBe(true);expect(f.pending.value).toBeNull()
 })
 it('原请求重试保留原版本和金额，连续点击仅提交一笔',async()=>{
  const f=fixture();let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}))
  const first=f.start(9,'商品',payload);await f.run('submit');expect(f.request).toHaveBeenCalledOnce();const a=f.pending.value!
  release(confirmed(a.requestId));expect(await first).toBe(true);expect(f.request.mock.calls[0][1].payload).toEqual(payload)
 })
 it('切换账号或撤权时迟到成功不能清除旧账号原请求',async()=>{
  const f=fixture();let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));const first=f.start(9,'商品',payload);const id=f.pending.value!.requestId
  f.actor.value='8';f.owner.value=null;release(confirmed(id));expect(await first).toBe(false);expect(f.applied).not.toHaveBeenCalled();expect(f.rows.has('erp.pricing.reprice.7')).toBe(true)
 })
 it('错误回执和商品编号不匹配不能清除原请求',async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(Error('fetch'));await f.start(9,'商品',payload);const id=f.pending.value!.requestId
  for(const receipt of [{...confirmed(id),pricingId:10},{...confirmed(id),requestId:'other'},{...confirmed(id),version:'bad'}]){f.request.mockResolvedValueOnce(receipt);expect(await f.run('check')).toBe(false);expect(f.pending.value).not.toBeNull()}
 })
 it('坏存储阻止新调价，写入存储失败时不发送请求',async()=>{
  const f=fixture();f.rows.set('erp.pricing.reprice.7','{');f.owner.value='next';expect(f.blocked.value).toBe(true);await f.start(9,'商品',payload);expect(f.request).not.toHaveBeenCalled()
  f.rows.clear();f.owner.value='next2';vi.spyOn(f.storage,'setItem').mockImplementation(()=>{throw Error('quota')});await f.start(9,'商品',payload);expect(f.request).not.toHaveBeenCalled();expect(f.feedback.value).toContain('本次尚未提交')
 })
 it('核对后读取当前商品失败，保留原请求供继续核对',async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(Error('fetch'));await f.start(9,'商品',payload);const id=f.pending.value!.requestId
  f.request.mockResolvedValueOnce(confirmed(id));f.applied.mockRejectedValueOnce(Error('NetworkError'));expect(await f.run('check')).toBe(false);expect(f.pending.value).not.toBeNull();expect(f.rows.size).toBe(1)
 })
 it('另一页面改动本地原单后不得提交或清除其原请求',async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(Error('fetch'));await f.start(9,'商品',payload);const a=f.pending.value!
  f.rows.set('erp.pricing.reprice.7',JSON.stringify({...a,payload:{...payload,price:99}}));await f.run('submit');expect(f.request).toHaveBeenCalledOnce();expect(f.pending.value).not.toBeNull();expect(f.feedback.value).toContain('记录已变化')
 })
})
