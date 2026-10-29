import { randomUUID } from 'crypto'
import { AnnouncementService } from './announcement.service'
function fixture() {
 const receipts:any[]=[], cards:any[]=[]
 const operationLog={findFirst:jest.fn(async({where}:any)=>receipts.find(r=>r.operatorId===where.operatorId&&r.detail.clientRequestId===where.detail.equals)||null),create:jest.fn(async({data}:any)=>{const r={id:BigInt(receipts.length+1),...data};receipts.push(r);return r})}
 const tx:any={operationLog,$queryRaw:jest.fn(async()=>[{id:7n}]),announcement:{create:jest.fn(async({data}:any)=>{const r={id:BigInt(cards.length+1),...data};cards.push(r);return r})}}
 const db={...tx,$transaction:jest.fn(async fn=>fn(tx))},cache={invalidate:jest.fn()}
 return {service:new AnnouncementService(db as any,cache as any),tx,receipts,cards,cache}
}
const payload=()=>({clientRequestId:randomUUID(),title:'隔离定时公告',content:'正文',targetChannel:'erp',publishMode:'scheduled',scheduledAt:'2079-01-01'})
describe('公告发布原请求回执',()=>{
 it('相同原请求只创建一条公告，篡改原内容拒绝',async()=>{
  const f=fixture(),body=payload(),first=await f.service.create(body,7)
  expect(await f.service.create(body,7)).toEqual(first);expect(f.cards).toHaveLength(1);expect(f.receipts).toHaveLength(1)
  await expect(f.service.create({...body,content:'替换'},7)).rejects.toThrow('原公告发布内容不能更改')
 })
 it('取消未提交原请求会阻止迟到创建；取消已确认不会删除公告',async()=>{
  const f=fixture(),body=payload();expect((await f.service.cancelCreateRequest(body.clientRequestId,7)).status).toBe('cancelled')
  expect((await f.service.create(body,7)).status).toBe('cancelled');expect(f.cards).toHaveLength(0)
  const next=payload();await f.service.create(next,7);expect((await f.service.cancelCreateRequest(next.clientRequestId,7)).status).toBe('confirmed');expect(f.cards).toHaveLength(1)
 })
 it('回执读取绑定原账号；缺失编号或账号不创建公告',async()=>{
  const f=fixture(),body=payload();await f.service.create(body,7)
  expect((await f.service.createRequest(body.clientRequestId,8)).status).toBe('unknown')
  await expect(f.service.create({...body,clientRequestId:undefined},7)).rejects.toThrow('请求编号无效')
  await expect(f.service.create(payload(),0)).rejects.toThrow('原发布账号');expect(f.cards).toHaveLength(1)
 })
 it('已确认回执保留原ID，后来删除公告不会通过原请求重建',async()=>{
  const f=fixture(),body=payload();const first=await f.service.create(body,7);f.cards.splice(0)
  expect(await f.service.create(body,7)).toEqual(first);expect(f.cards).toHaveLength(0)
 })
})
