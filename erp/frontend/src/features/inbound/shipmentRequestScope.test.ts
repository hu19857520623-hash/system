import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShipmentRequestScope } from './shipmentRequestScope'
const stops:(()=>void)[]=[]
afterEach(()=>{stops.splice(0).forEach(stop=>stop());vi.restoreAllMocks()})
function fixture(){
 const owner=ref(7),session=ref<string|null>('token/role/permissions7'),allowed=ref(true),scope=effectScope()
 const guard=scope.run(()=>useShipmentRequestScope({actor:()=>owner.value,scope:()=>session.value,allowed:()=>allowed.value}))!
 const original={payload:{clientRequestId:'original',items:[{expectedQty:2}]}},rows=new Map([[7,JSON.stringify(original)],[8,JSON.stringify({payload:{clientRequestId:'other'}})]])
 const read=(actor:number)=>JSON.parse(rows.get(actor)||'null'),request=vi.fn(),apply=vi.fn(async()=>{rows.delete(7)})
 stops.push(()=>scope.stop());return {owner,session,allowed,guard,original,rows,read,request,apply,stop:()=>scope.stop()}
}
describe('发运结果的原账号和原记录边界',()=>{
 it('请求中切换账号，迟到成功不得执行清除或显示结果回调',async()=>{
  const f=fixture(),frame=f.guard.capture();let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}))
  const run=frame.run(f.original,f.read,f.request,f.apply);f.owner.value=8;f.session.value='token8';release({inboundNo:'RV7'})
  expect(await run).toBe(false);expect(f.apply).not.toHaveBeenCalled();expect([...f.rows.keys()]).toEqual([7,8])
 })
 it.each(['token refreshed','role changed','permissions revoked'])('同账号 %s 使旧响应失效，原单仍保留',async next=>{
  const f=fixture(),frame=f.guard.capture();let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}))
  const run=frame.run(f.original,f.read,f.request,f.apply);f.session.value=next;release({ok:true});expect(await run).toBe(false);expect(f.apply).not.toHaveBeenCalled();expect(f.rows.has(7)).toBe(true)
 })
 it('切换范围后再切回，旧请求仍不能恢复为当前请求',async()=>{
  const f=fixture(),frame=f.guard.capture();let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}))
  const run=frame.run(f.original,f.read,f.request,f.apply);f.session.value='other';f.session.value='token/role/permissions7';release({ok:true})
  expect(await run).toBe(false);expect(f.apply).not.toHaveBeenCalled()
 })
 it('离页后确认框的迟到确认不能发起请求，离页中的响应不能清原单',async()=>{
  const f=fixture(),frame=f.guard.capture();f.stop();expect(await frame.run(f.original,f.read,f.request,f.apply)).toBe(false);expect(f.request).not.toHaveBeenCalled()
  const g=fixture(),pending=g.guard.capture();let release!:(v:any)=>void;g.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));const run=pending.run(g.original,g.read,g.request,g.apply);g.stop();release({ok:true});expect(await run).toBe(false);expect(g.apply).not.toHaveBeenCalled();expect(g.rows.has(7)).toBe(true)
 })
 it('存储在发送前或返回前更换，不得发送旧内容或清除新内容',async()=>{
  const f=fixture(),frame=f.guard.capture();f.rows.set(7,JSON.stringify({payload:{clientRequestId:'new'}}))
  await expect(frame.run(f.original,f.read,f.request,f.apply)).rejects.toThrow('原发运操作记录已变化');expect(f.request).not.toHaveBeenCalled()
  f.rows.set(7,JSON.stringify(f.original));let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));const run=frame.run(f.original,f.read,f.request,f.apply);f.rows.set(7,JSON.stringify({payload:{clientRequestId:'new'}}));release({ok:true});await expect(run).rejects.toThrow('记录已变化');expect(f.apply).not.toHaveBeenCalled();expect(f.read(7).payload.clientRequestId).toBe('new')
 })
 it('同账号存储事件使旧请求失效；撤权不发送新请求',async()=>{
  const f=fixture(),frame=f.guard.capture();f.guard.invalidate();expect(await frame.run(f.original,f.read,f.request,f.apply)).toBe(false)
  f.allowed.value=false;expect(await f.guard.capture().run(f.original,f.read,f.request,f.apply)).toBe(false);expect(f.request).not.toHaveBeenCalled()
 })
 it('合法结果只处理原账号，传给请求的副本不会污染持久内容',async()=>{
  const f=fixture(),frame=f.guard.capture();f.request.mockImplementation(async original=>{original.payload.items[0].expectedQty=99;return {inboundNo:'RV7'}})
  expect(await frame.run(f.original,f.read,f.request,f.apply)).toBe(true);expect(frame.owner).toBe(7);expect(f.original.payload.items[0].expectedQty).toBe(2);expect(f.apply).toHaveBeenCalledOnce();expect(f.rows.has(8)).toBe(true)
 })
 it('403和网络拒绝不会调用成功清除，恢复权限后仍可使用原单',async()=>{
  const f=fixture(),frame=f.guard.capture();f.request.mockRejectedValueOnce(Object.assign(Error('permission'),{status:403}));await expect(frame.run(f.original,f.read,f.request,f.apply)).rejects.toMatchObject({status:403});expect(f.rows.has(7)).toBe(true);expect(f.apply).not.toHaveBeenCalled()
 })
 it('保存草稿等待期间切换身份，后续文件读取和上传都不再开始',async()=>{
  const f=fixture(),frame=f.guard.capture();let release!:(v:any)=>void;const save=vi.fn(()=>new Promise(resolve=>{release=resolve})),upload=vi.fn(),readFile=vi.fn()
  const pipeline=(async()=>{await frame.step(save);await frame.step(readFile);await frame.step(upload)})();f.owner.value=8;f.session.value='new';release({draftNo:'D7'})
  await expect(pipeline).rejects.toThrow('登录权限已变化');expect(upload).not.toHaveBeenCalled();expect(readFile).not.toHaveBeenCalled()
 })
 it('读取文件期间离页，不能在新页面上下文上传旧文件',async()=>{
  const f=fixture(),frame=f.guard.capture();let release!:(v:any)=>void;const readFile=vi.fn(()=>new Promise(resolve=>{release=resolve})),upload=vi.fn()
  const pipeline=(async()=>{await frame.step(readFile);await frame.step(upload)})();f.stop();release('old bytes');await expect(pipeline).rejects.toThrow('原操作已离开');expect(upload).not.toHaveBeenCalled()
 })
 it('上传期间撤权，迟到结果不能追加附件或切换新页面页签',async()=>{
  const f=fixture(),frame=f.guard.capture();let release!:(v:any)=>void;const apply=vi.fn();const pipeline=(async()=>{const result=await frame.step(()=>new Promise(resolve=>{release=resolve}));apply(result)})()
  f.allowed.value=false;release({fileName:'old.txt'});await expect(pipeline).rejects.toThrow('权限已变化');expect(apply).not.toHaveBeenCalled()
 })
 it('只读岗位可读取，但不能借读取范围启动写请求',async()=>{
  const f=fixture();f.allowed.value=false;const read=vi.fn(async()=>({id:81}));expect(await f.guard.captureRead().step(read)).toEqual({id:81});expect(f.guard.capture().active()).toBe(false)
 })
 it('只读请求也受会话和离页限制，旧错误不进入当前结果分支',async()=>{
  const f=fixture(),frame=f.guard.captureRead();let release!:(v:any)=>void;const apply=vi.fn();const pipeline=(async()=>{apply(await frame.step(()=>new Promise(resolve=>{release=resolve})))})()
  f.session.value='new session';release({id:81});await expect(pipeline).rejects.toThrow('权限已变化');expect(apply).not.toHaveBeenCalled()
 })
 it('合法多步骤保持原草稿编号，直到相同上下文才应用附件结果',async()=>{
  const f=fixture(),frame=f.guard.capture(),upload=vi.fn(async(draftNo:string)=>({draftNo,fileName:'ok.txt'}))
  const saved=await frame.step(async()=>({draftNo:'D7'}));const result=await frame.step(()=>upload(saved.draftNo));expect(result).toEqual({draftNo:'D7',fileName:'ok.txt'});expect(upload).toHaveBeenCalledWith('D7')
 })

 it('步骤返回后排队的身份更新也必须在回填前拦截',async()=>{
  const f=fixture(),frame=f.guard.capture(),apply=vi.fn()
  const result=frame.step(async()=>({fileName:'old.txt'}))
  void result.then(()=>{f.session.value='new session'})
  const value=await result
  if(frame.active())apply(value)
  expect(frame.active()).toBe(false);expect(apply).not.toHaveBeenCalled()
 })

})
