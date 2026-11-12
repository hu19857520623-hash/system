import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { hydrateAccounts } from '../auth/accountStore'
import { getReturnOrdersSnapshot, setReturnOrders, cacheReturnOrder, upsertReturnOrderOrThrow, addReturnOrdersOrThrow, updateReturnOrderOrThrow } from './entityStore'
import { submitReturnWorkflow, replayReturnWithdrawal, decideReturnOrder, replayReturnDecision, refreshReturnsFromErp, removeReturnOrder, nextReturnNo, type ReturnOrder } from './returnStore'
import { buildImportedReturnDrafts } from './returnDraftImport'
import { parseReturnLines, parseReturnOrders } from './importTemplates'

const draft:ReturnOrder={id:'rt-original',customerId:'c1',returnNo:'RT-TKL9001-20261019001',orderNo:'AUDIT-ORDER',returnWarehouse:'JHB3',returnReason:'平台退货',requestedProcess:'pending_inspection',status:'draft',createdAt:'2026-10-19',lineItems:[{sku:'TKL9001-A',name:'商品',qty:2}]}
const confirmed={...draft,id:31,status:'pending_arrival',statusLabel:'在途',items:[{sku:'TKL9001-A',productName:'商品',quantity:2}]}
test('编辑期间退件消失或进入后续状态时，保存草稿明确失败且不发送写入', async t => {
 environment(t)
 let writes = 0
 globalThis.fetch = async () => { writes++; return Response.json({ ok: true }) }
 setReturnOrders([])
 await assert.rejects(updateReturnOrderOrThrow(draft.id, draft), /返回退件处理核对/)
 const submitted = { ...draft, status: 'pending_arrival' as const }
 setReturnOrders([submitted])
 await assert.rejects(updateReturnOrderOrThrow(draft.id, draft), /状态已变化/)
 assert.deepEqual(getReturnOrdersSnapshot(), [submitted])
 assert.equal(writes, 0)
})
test('退件决定仅在明确拒绝或已确认冲突时结束原请求', async t => {
 environment(t)
 const intent = { returnNo: draft.returnNo, customerCode: 'TKL9001', customerId: 'c1', decision: 'keep' as const, processChoice: 'restock' }
 for (const [status, expected, contentChanged] of [[400, 'rejected', false], [422, 'rejected', false], [409, 'conflict', true], [403, undefined, false], [503, undefined, false]] as const) {
  globalThis.fetch = async () => Response.json({ error: '退件决定未确认' }, { status })
  const result = await replayReturnDecision(intent)
  assert.equal(result.ok, false)
  assert.equal('resolution' in result ? result.resolution : undefined, expected)
  assert.equal('contentChanged' in result && result.contentChanged, contentChanged)
 }
})
test('原退件决定可在本地状态更新后重放，身份切换后丢弃迟到结果', async t => {
 environment(t)
 let current = true, writes = 0
 const intent = { returnNo: draft.returnNo, customerId: 'c1', customerCode: 'TKL9001', decision: 'keep' as const, processChoice: 'restock' }
 globalThis.fetch = async (input, init) => {
  if (String(input).endsWith('/decide')) {
   assert.deepEqual(JSON.parse(String(init?.body)), { customerCode: 'TKL9001', decision: 'keep', processChoice: 'restock' })
   return Response.json({ ...confirmed, status: 'completed' })
  }
  writes++; return Response.json({ ok: true })
 }
 const replay = replayReturnDecision(intent, () => current)
 current = false
 assert.equal((await replay).ok, false)
 assert.equal(writes, 0)
 current = true
 assert.equal((await replayReturnDecision(intent, () => current)).ok, true)
 assert.equal(writes, 1)
})
function environment(t:TestContext){
 const original=globalThis.fetch
 const descriptors=['localStorage','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
 for(const [key] of descriptors)Object.defineProperty(globalThis,key,{configurable:true,value:{getItem:()=>null,removeItem:()=>{}}})
 hydrateAccounts([{id:'c1',code:'TKL9001',permissions:[]} as any]);setReturnOrders([draft])
 t.after(()=>{globalThis.fetch=original;setReturnOrders([]);hydrateAccounts([]);for(const [key,value] of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key)}})
}
test('稳定单号先保存待核对请求，ERP确认后只保存当前记录并保留OMS标识',async t=>{
 environment(t);setReturnOrders([draft,{...draft,id:'other',returnNo:'OTHER',status:'completed'}]);const states:string[]=[]
 globalThis.fetch=async(input,init)=>{
  if(String(input)==='/api/erp/returns'){assert.equal(getReturnOrdersSnapshot()[0].status,'submission_pending');return Response.json(confirmed)}
  assert.equal(String(input),'/api/return-orders');const rows=JSON.parse(String(init?.body));assert.equal(rows.length,1);states.push(rows[0].status);return Response.json({ok:true})
 }
 const result=await submitReturnWorkflow(draft);assert.equal(result.ok,true);if(result.ok)assert.equal(result.order.id,draft.id)
 assert.deepEqual(states,['submission_pending','pending_arrival']);assert.equal(getReturnOrdersSnapshot().length,2)
})
for(const status of [400,403,422])test(`明确拒绝${status}保留同号草稿供修改`,async t=>{
 environment(t);globalThis.fetch=async input=>String(input)==='/api/erp/returns'?Response.json({error:'商品资料无效'},{status}):Response.json({ok:true})
 const result=await submitReturnWorkflow(draft);assert.equal(result.ok,false);if(!result.ok){assert.equal(result.uncertain,false);assert.match(result.error,/商品资料无效/)}
 assert.equal(getReturnOrdersSnapshot()[0].status,'draft');assert.equal(getReturnOrdersSnapshot()[0].id,draft.id)
})
for(const status of [0,408,409,503])test(`未知结果${status}不变成可编辑草稿，保留待核对记录`,async t=>{
 environment(t);let saves=0;globalThis.fetch=async input=>{
  if(String(input)==='/api/return-orders'){saves++;return Response.json({ok:true})}
  if(!status)throw new TypeError('Failed to fetch');return Response.json({error:'Storage unavailable'},{status})
 }
 const result=await submitReturnWorkflow(draft);assert.equal(result.ok,false);if(!result.ok){assert.equal(result.uncertain,true);assert.match(result.error,/结果暂无法确认.*请勿重复操作/)}
 assert.equal(getReturnOrdersSnapshot()[0].status,'submission_pending');assert.equal(saves,1)
})
test('ERP已接单但OMS回写失败仍保留确认结果并返回部分成功',async t=>{
 environment(t);let saves=0;globalThis.fetch=async input=>String(input)==='/api/erp/returns'?Response.json(confirmed):++saves===1?Response.json({ok:true}):Response.json({error:'Storage unavailable'},{status:503})
 const result=await submitReturnWorkflow(draft);assert.equal(result.ok,true);if(result.ok)assert.match(result.warning||'',/已在 ERP 接单.*OMS 回写失败/)
 assert.equal(getReturnOrdersSnapshot()[0].status,'pending_arrival')
})
test('请求保存失败不发送ERP',async t=>{
 environment(t);const calls:string[]=[];globalThis.fetch=async input=>{calls.push(String(input));return Response.json({error:'Storage unavailable'},{status:503})}
 const result=await submitReturnWorkflow(draft);assert.equal(result.ok,false);assert.deepEqual(calls,['/api/return-orders']);assert.equal(getReturnOrdersSnapshot()[0].status,'draft')
})
test('已明确拒绝但草稿恢复失败时要求核对，不鼓励再次提交',async t=>{
 environment(t);let saves=0;globalThis.fetch=async input=>String(input)==='/api/erp/returns'?Response.json({error:'无效资料'},{status:400}):++saves===1?Response.json({ok:true}):Response.json({error:'Storage unavailable'},{status:503})
 const result=await submitReturnWorkflow(draft);assert.equal(result.ok,false);if(!result.ok){assert.equal(result.uncertain,true);assert.match(result.error,/草稿恢复未确认/)}
 assert.equal(getReturnOrdersSnapshot()[0].status,'submission_pending')
})
test('保存失败不会覆盖等待期间同单据及其他单据的新状态',async t=>{
 environment(t);let release!:(value:Response)=>void;globalThis.fetch=async()=>new Promise(resolve=>{release=resolve})
 const saving=upsertReturnOrderOrThrow({...draft,remark:'修改'})
 cacheReturnOrder({...draft,status:'received'});cacheReturnOrder({...draft,id:'other',returnNo:'OTHER',status:'completed'})
 release(Response.json({error:'Storage unavailable'},{status:503}));await assert.rejects(saving)
 assert.equal(getReturnOrdersSnapshot().find(row=>row.id===draft.id)?.status,'received');assert.equal(getReturnOrdersSnapshot().length,2)
})
test('退件决定等待OMS回写，失败后保留ERP确认状态',async t=>{
 environment(t);const source={...draft,status:'awaiting_customer'};setReturnOrders([source])
 globalThis.fetch=async input=>String(input)==='/api/return-orders'?Response.json({error:'Storage unavailable'},{status:503}):Response.json({...confirmed,status:'accepted_pending'})
 const result=await decideReturnOrder(source,'keep',{processChoice:'restock'})
 assert.equal(result.ok,true);if(result.ok)assert.match(result.warning||'',/OMS 回写失败/)
 assert.equal(getReturnOrdersSnapshot()[0].status,'accepted_pending')
})
test('撤回失败后可用原标识和版本继续，已重新提交时保留 ERP 当前状态', async t => {
 environment(t)
 const intent = { returnNo: draft.returnNo, customerId: 'c1', customerCode: 'TKL9001',
  expectedUpdatedAt: '2026-10-19T12:00:00.000Z', clientRequestId: crypto.randomUUID() }
 let calls = 0
 globalThis.fetch = async (input, init) => {
  assert.match(String(input), /\/cancel$/)
  assert.deepEqual(JSON.parse(String(init?.body)), {
   customerCode: intent.customerCode, expectedUpdatedAt: intent.expectedUpdatedAt, clientRequestId: intent.clientRequestId,
  })
  if (++calls === 1) return Response.json({ error: '暂时无法连接 ERP' }, { status: 503 })
  if (calls === 2) return Response.json({ ...confirmed, idempotent: true, updatedAt: '2026-10-19T12:05:00.000Z' })
  return Response.json({ error: '退件单已更新，请刷新核对后再发起撤回' }, { status: 409 })
 }
 const uncertain = await replayReturnWithdrawal(intent)
 assert.equal(uncertain.ok, false)
 if (!uncertain.ok) assert.equal(uncertain.uncertain, true)
 setReturnOrders([])
 const replay = await replayReturnWithdrawal(JSON.parse(JSON.stringify(intent)))
 assert.equal(replay.ok, true)
 assert.equal(getReturnOrdersSnapshot()[0].status, 'pending_arrival')
 const stale = await replayReturnWithdrawal(intent)
 assert.equal(stale.ok, false)
 if (!stale.ok) assert.equal(stale.uncertain, false)
 assert.equal(calls, 3)
})
test('ERP刷新仅更新读取到的退件状态，不要求写入权限或发送快照',async t=>{
 environment(t);let calls=0
 globalThis.fetch=async(input,init)=>{
  calls++;assert.ok(String(input).includes('/erp/returns/by-customer/'));assert.ok(!init?.method||init.method==='GET')
  return Response.json({items:[confirmed],total:1})
 }
 assert.equal(await refreshReturnsFromErp('c1'),1);assert.equal(calls,1)
 assert.equal(getReturnOrdersSnapshot()[0].status,'pending_arrival')
})
test('同步退件不会沿用其他客户同号草稿的标识或备注', async t => {
 environment(t)
 const other = { ...draft, id: 'other-customer-draft', customerId: 'c2', remark: '其他客户备注' }
 setReturnOrders([other])
 globalThis.fetch = async () => Response.json({ items: [confirmed], total: 1 })
 await refreshReturnsFromErp('c1')
 const rows = getReturnOrdersSnapshot()
 assert.deepEqual(rows.find(order => order.customerId === 'c2'), other)
 const synced = rows.find(order => order.customerId === 'c1')
 assert.equal(synced?.id, 'erp-rt-31')
 assert.equal(synced?.remark, undefined)
})

test('删除等待服务器确认，失败时保留原记录和并发刷新',async t=>{
 environment(t);let release!:(value:Response)=>void;globalThis.fetch=async input=>{
   assert.match(String(input), /[?]expectedStatus=draft$/)
   return new Promise(resolve=>{release=resolve})
 }
 const deleting=removeReturnOrder(draft);assert.equal(getReturnOrdersSnapshot().length,1);cacheReturnOrder({...draft,id:'other',returnNo:'OTHER',status:'completed'})
 release(Response.json({error:'退件删除结果暂无法确认，请刷新退件列表核对后再试'},{status:503}))
 assert.deepEqual(await deleting, { ok: false, error: '删除结果未确认，请刷新退件列表核对后再试' })
 assert.equal(getReturnOrdersSnapshot().length,2)
})
test('删除成功回执只移除提交时的退件快照', async t => {
 environment(t)
 let release!: (value: Response) => void
 globalThis.fetch = async () => new Promise(resolve => { release = resolve })
 const deleting = removeReturnOrder(draft)
 const newer = { ...draft, status: 'cancelled' as const }
 cacheReturnOrder(newer)
 release(Response.json({ ok: true }))
 assert.equal((await deleting).ok, true)
 assert.deepEqual(getReturnOrdersSnapshot(), [newer])
})
test('切换账号后迟到的删除回执不修改当前列表', async t => {
 environment(t)
 let session = ''
 Object.defineProperty(globalThis, 'localStorage', {
  configurable: true, value: { getItem: () => session || null, removeItem: () => {} },
 })
 let release!: (value: Response) => void
 globalThis.fetch = async () => new Promise(resolve => { release = resolve })
 const deleting = removeReturnOrder(draft)
 session = JSON.stringify({ token: 'test-session', user: { id: 'other', username: 'other', role: 'sys_admin', permissions: [] } })
 release(Response.json({ ok: true }))
 assert.deepEqual(getReturnOrdersSnapshot(), [draft])
 assert.equal((await deleting).ok, false)
 assert.deepEqual(getReturnOrdersSnapshot(), [draft])
})
test('退件删除区分状态冲突、记录缺失和结果未知', async t => {
 environment(t)
 for (const [status, serverError, expected] of [
  [409, '退件单状态已变化，请刷新后核对', '退件单状态已变化，请刷新后核对'],
  [404, '退件单不存在', '退件单已不在当前列表，请刷新核对'],
  [503, 'Service unavailable', '删除结果未确认，请刷新退件列表核对后再试'],
 ] as const) {
  globalThis.fetch = async () => Response.json({ error: serverError }, { status })
  assert.deepEqual(await removeReturnOrder(draft), { ok: false, error: expected })
  assert.deepEqual(getReturnOrdersSnapshot(), [draft])
 }
})
test('提交后记录不可删除，不发出删除请求',async t=>{
 environment(t);globalThis.fetch=async()=>{throw new Error('Unexpected request')}
 assert.equal((await removeReturnOrder({...draft,status:'received'})).ok,false)
})
test('批量导入使用短UUID、同客户连续编号，等待整批事务且失败回滚',async t=>{
 environment(t);const row={headerKey:'长备注'.repeat(200),orderNo:'O1',returnWarehouse:'JHB3',returnReason:'平台退货',requestedProcess:'restock',lineItems:draft.lineItems}
 const date=new Date(2026,9,19)
 const imported=buildImportedReturnDrafts([row,{...row,orderNo:'O2'}],{customerId:'c1',customerCode:'TKL9001',existingNos:[draft.returnNo],date})
 assert.equal(imported[0].returnNo,'RT-TKL9001-20261019002');assert.equal(imported[1].returnNo,'RT-TKL9001-20261019003');assert.ok(imported.every(order=>order.id.length<=50));assert.notEqual(imported[0].id,imported[1].id)
 assert.equal(nextReturnNo('TKL9002',date,[draft.returnNo]),'RT-TKL9002-20261019001')
 let release!:(value:Response)=>void;globalThis.fetch=async(_input,init)=>{assert.equal(JSON.parse(String(init?.body)).length,2);return new Promise(resolve=>{release=resolve})}
 const saving=addReturnOrdersOrThrow(imported);release(Response.json({error:'Storage unavailable'},{status:503}));await assert.rejects(saving);assert.equal(getReturnOrdersSnapshot().length,1)
})
test('导入拒绝小数、不安全数量及空SKU，并保留正确行',()=>{
 const rows=[{sku:'A',qty:'2'},{sku:'B',qty:'1.5'},{sku:'',qty:'1'},{sku:'C',qty:'9007199254740992'}]
 assert.equal(parseReturnLines(rows).data.length,1)
 const records=rows.map(row=>({...row,orderNo:'O',returnWarehouse:'JHB3',returnReason:'平台退货',requestedProcess:'检查拍照',expectedArrivalAt:''}))
 const result=parseReturnOrders(records);assert.equal(result.data.length,1);assert.equal(result.data[0].lineItems.length,1);assert.equal(result.failures?.length,3)
})
