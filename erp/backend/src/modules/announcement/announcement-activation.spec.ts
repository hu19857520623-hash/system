import { AnnouncementService } from './announcement.service'
function fixture() {
 const selected:any={id:11n,title:'定时公告',content:'正文',category:'系统',targetChannel:'erp',status:'scheduled',scheduledAt:new Date('2020-01-01'),expiresAt:null,publishedAt:null,updatedAt:new Date('2020-01-01'),createdAt:new Date(0)}
 let current:any={...selected}
 const announcement={findMany:jest.fn(async()=>[selected]),findUnique:jest.fn(async()=>current),findUniqueOrThrow:jest.fn(async()=>current),updateMany:jest.fn(async({data}:any)=>{current={...current,...data};return{count:1}})}
 const tx={$queryRaw:jest.fn(async()=>[]),announcement},cache={invalidate:jest.fn()},db={announcement,$transaction:jest.fn(async fn=>fn(tx))}
 const service=new AnnouncementService(db as any,cache as any),push=jest.spyOn(service as any,'pushToOms').mockResolvedValue(true)
 return{selected,announcement,cache,service,push,set:(row:any)=>{current=row},get:()=>current}
}
describe('定时公告发布与手工编辑竞态',()=>{
 it('正常到期只发布一次并返回实际发布数量',async()=>{
  const f=fixture();expect(await f.service.activateDueAnnouncements(new Date('2026-01-01'))).toBe(1)
  expect(f.get().status).toBe('published');expect(await f.service.activateDueAnnouncements(new Date('2026-01-01'))).toBe(0)
  expect(f.announcement.updateMany).toHaveBeenCalledTimes(1)
 })
 it.each(['reschedule','draft','deleted','changed'])('旧定时快照不能覆盖%s后的新记录',async mode=>{
  const f=fixture();f.set(mode==='deleted'?null:{...f.selected,...(mode==='reschedule'?{scheduledAt:new Date('2090-01-01')}:mode==='draft'?{status:'draft'}:{content:'新正文',updatedAt:new Date('2026-01-01')})})
  expect(await f.service.activateDueAnnouncements(new Date('2080-01-01'))).toBe(0)
  expect(f.announcement.updateMany).not.toHaveBeenCalled();expect(f.push).not.toHaveBeenCalled();expect(f.cache.invalidate).not.toHaveBeenCalled()
 })
 it('到期时已经过期的计划不会推送OMS，并退出待发布队列',async()=>{
  const f=fixture();f.set({...f.selected,targetChannel:'oms',expiresAt:new Date('2021-01-01')})
  expect(await f.service.activateDueAnnouncements(new Date('2026-01-01'))).toBe(0)
  expect(f.get().status).toBe('expired');expect(f.get().publishedAt).toBeNull();expect(f.push).not.toHaveBeenCalled()
 })
 it('并发版本不匹配或数据库失败不能返回发布成功或推送OMS',async()=>{
  const f=fixture();f.set({...f.selected,targetChannel:'oms'});f.announcement.updateMany.mockResolvedValueOnce({count:0})
  expect(await f.service.activateDueAnnouncements(new Date('2026-01-01'))).toBe(0);expect(f.push).not.toHaveBeenCalled()
  f.announcement.updateMany.mockRejectedValueOnce(Error('数据库写入失败'))
  await expect(f.service.activateDueAnnouncements(new Date('2026-01-01'))).rejects.toThrow('数据库写入失败');expect(f.push).not.toHaveBeenCalled()
 })
})
