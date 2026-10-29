import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnnouncementPublish } from './announcementPublish'
const stops: (()=>void)[]=[]
afterEach(()=>{stops.splice(0).forEach(fn=>fn());vi.restoreAllMocks()})
function fixture() {
 const rows=new Map<string,string>(),storage={getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v)},removeItem:(k:string)=>{rows.delete(k)}}
 const scope=effectScope(), owner=ref('session:7:manage'), actor=ref('7'), request=vi.fn(), applied=vi.fn(async()=>{})
 const controller=scope.run(()=>useAnnouncementPublish({actor:()=>actor.value,scope:()=>owner.value,storage,request,applied}))!
 stops.push(()=>scope.stop());return {rows,storage,scope,owner,actor,request,applied,...controller}
}
describe('公告原发布恢复',()=>{
 it('发送前持久化原内容；失败、返回后保留同一请求并能核对恢复',async()=>{
  const f=fixture();f.request.mockImplementationOnce(async(_mode,a)=>{expect(JSON.parse([...f.rows.values()][0]).requestId).toBe(a.requestId);throw Error('NetworkError')})
  await f.start({title:'原标题',content:'原正文'});const id=f.pending.value!.requestId
  expect(f.feedback.value).toContain('原公告发布已保留');expect(f.feedback.value).not.toContain('NetworkError')
  await f.start({title:'替换禁止',content:'新内容'});expect(f.request).toHaveBeenCalledTimes(1)
  f.request.mockResolvedValueOnce({requestId:id,status:'confirmed',announcementId:18})
  await f.run('check');expect(f.applied).toHaveBeenCalledOnce();expect(f.pending.value).toBeNull();expect(f.rows.size).toBe(0)
 })
 it('重载恢复原请求，确认取消之前不清除；OMS推送未完成继续保留',async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(Error('Failed to fetch'));await f.start({title:'测试',content:'正文'})
  const id=f.pending.value!.requestId;f.owner.value='sameactor-newtoken';expect(f.pending.value!.requestId).toBe(id)
  f.request.mockResolvedValueOnce({requestId:id,status:'confirmed',announcementId:9,syncPending:true});await f.run('submit');expect(f.pending.value).not.toBeNull();expect(f.feedback.value).toContain('OMS推送')
  f.request.mockResolvedValueOnce({requestId:id,status:'cancelled'});await f.run('cancel');expect(f.rows.size).toBe(0);expect(f.feedback.value).toContain('已取消')
 })
 it('当前身份或权限变化后迟到成功不能清除原账号记录',async()=>{
  const f=fixture();let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}))
  const pending=f.start({title:'账号7',content:'正文'});const id=f.pending.value!.requestId
  f.actor.value='8';f.owner.value='session:8:manage';release({requestId:id,status:'confirmed',announcementId:9});await pending
  expect(f.applied).not.toHaveBeenCalled();expect(f.rows.has('erp.announcement.publish.7')).toBe(true);expect(f.pending.value).toBeNull()
 })
 it('坏存储阻止新发布；存储写失败不会提交请求',async()=>{
  const f=fixture();f.rows.set('erp.announcement.publish.7','{');f.owner.value='next';expect(f.blocked.value).toBe(true)
  await f.start({title:'禁止',content:'正文'});expect(f.request).not.toHaveBeenCalled()
  f.rows.clear();f.owner.value='next2';vi.spyOn(f.storage,'setItem').mockImplementation(()=>{throw Error('quota')})
  await f.start({title:'失败',content:'正文'});expect(f.request).not.toHaveBeenCalled();expect(f.feedback.value).toContain('本次尚未提交')
 })
 it('错误回执和未知回执不能清除原请求；连续点击不重复请求',async()=>{
  const f=fixture();let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(resolve=>{release=resolve}))
  const p=f.start({title:'并发',content:'正文'});await f.run('submit');expect(f.request).toHaveBeenCalledTimes(1)
  const id=f.pending.value!.requestId;release({requestId:'other',status:'confirmed',announcementId:9});await p;expect(f.pending.value).not.toBeNull()
  f.request.mockResolvedValueOnce({requestId:id,status:'unknown'});await f.run('check');expect(f.pending.value).not.toBeNull();expect(f.feedback.value).toContain('尚未查到')
 })
})
