import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { getCreditBalance, getFeeRecords, hydrateBilling, refreshBillingFromErp, refreshBillingFromServer, setCreditBalanceFromErp, preDeductOutboundFees, rollbackPreDeductOutboundFees, rechargeViaErp, pendingRecharge } from './billingStore'
import { groupFeeRecordsByOutbound } from './outboundFeeUtils'
import type { FeeRecord } from './mockData'
import { useBilling } from './billingStore'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const billingWarning = () => renderToStaticMarkup(createElement(() => createElement('p',null,useBilling().readWarning || '')))
function environment(t: TestContext, admin=false) {
  const old=globalThis.fetch, values=new Map<string,string>(), s={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
  const user={id:'u1',username:'audit-user',role:admin?'sys_admin':'catalog',customerId:admin?null:'c1',customerCode:admin?'':'TKL9001',permissions:['billing:read']}
  s.setItem('oms-auth-session',JSON.stringify({token:'virtual-token',user}))
  const descriptors=['localStorage','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:s});Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null,removeItem:()=>{}}})
  hydrateBilling({creditBalance:100,feeRecords:[]})
  t.after(()=>{globalThis.fetch=old;hydrateBilling({creditBalance:0,feeRecords:[]});for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}})
  return {s,user}
}
const snapshot=(balance=50,code='TKL9001')=>({customerCode:code,customerName:'隔离客户',creditBalance:balance,feeRecords:[{id:'erp-chg-1',date:'2026-10-23',type:'handling',refNo:'REF',desc:'实际已付',amount:-5,method:'actual',customerCode:code}],bills:[],monthlySpent:5,pendingBill:3,reservedAmount:10,reviewAmount:0,provisionalChargeCount:1,billingMonth:'2026-10',source:'erp',snapshotAt:'2026-10-23T00:00:00Z'})
test('账务刷新只发一笔只读请求，替换不可信旧流水，不回写余额或费用',async t=>{
  environment(t);hydrateBilling({creditBalance:999,feeRecords:[{id:'local-forged',date:'2026-10-23',type:'recharge',refNo:'FAKE',desc:'旧缓存',amount:999,method:'actual'}]})
  const requests:string[]=[];globalThis.fetch=async(input,init)=>{requests.push(String(input));assert.ok(!init?.method||init.method==='GET');return Response.json(snapshot())}
  const result=await refreshBillingFromServer();assert.equal(result.monthlySpent,5);assert.equal(getCreditBalance(),50);assert.deepEqual(getFeeRecords().map(r=>r.id),['erp-chg-1'])
  assert.deepEqual(requests,['/api/erp/customers/TKL9001/billing-snapshot'])
})
test('余额应用仅改变本机展示，不上传整包财务缓存',async t=>{
  environment(t);globalThis.fetch=async()=>{throw Error('不应调用写接口')}
  await setCreditBalanceFromErp(30,'TKL9001');assert.equal(getCreditBalance(),30)
  await assert.rejects(setCreditBalanceFromErp(999,'OTHER'),/客户身份已变化/);assert.equal(getCreditBalance(),30)
})
test('管理员按客户读取，但不把所选客户的钱包变成管理员全局余额',async t=>{
  environment(t,true);globalThis.fetch=async()=>Response.json(snapshot(2,'TKL9002'))
  assert.equal((await refreshBillingFromErp('TKL9002')).creditBalance,2);assert.equal(getCreditBalance(),100)
})
test('拒绝客户跨客户读取，未发送请求',async t=>{
  environment(t);let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(snapshot())}
  await assert.rejects(refreshBillingFromErp('TKL9002'),/不能跨客户读取/);assert.equal(calls,0)
})
for(const status of [403,500,503])test(`账务读取${status}失败不当作成功或清空原余额`,async t=>{
  environment(t);globalThis.fetch=async()=>Response.json({error:'Internal Server Error'},{status})
  await assert.rejects(refreshBillingFromErp('TKL9001'));assert.equal(getCreditBalance(),100)
})
test('读取期间切换客户，旧响应不能覆盖新会话',async t=>{
  const {s,user}=environment(t);let finish!:(response:Response)=>void
  globalThis.fetch=async()=>new Promise(resolve=>{finish=resolve})
  const read=refreshBillingFromErp('TKL9001');while(!finish)await new Promise(resolve=>setImmediate(resolve))
  s.setItem('oms-auth-session',JSON.stringify({token:'new-virtual-token',user:{...user,id:'u2',customerId:'c2',customerCode:'TKL9002'}}));finish(Response.json(snapshot()))
  await assert.rejects(read,/登录身份(?:或权限)?已变化/);assert.equal(getCreditBalance(),100)
})

for(const change of ['token','permissions','role','warehouse','customerCode','status'])test(`同账号${change}变化后迟到财务响应不能写回`,async t=>{
  const {s,user}=environment(t);let finish!:(response:Response)=>void
  globalThis.fetch=async()=>new Promise(resolve=>{finish=resolve})
  const read=refreshBillingFromErp('TKL9001');while(!finish)await new Promise(resolve=>setImmediate(resolve))
  const changed={...user,...(change==='permissions'?{permissions:[]}:change==='role'?{role:'ecommerce'}:change==='warehouse'?{warehouse:'cpt1'}:change==='customerCode'?{customerCode:'TKL9002'}:change==='status'?{status:'disabled'}:{})}
  s.setItem('oms-auth-session',JSON.stringify({token:change==='token'?'new-token':'virtual-token',user:changed}));finish(Response.json(snapshot(999)))
  await assert.rejects(read,/登录身份或权限已变化/);assert.equal(getCreditBalance(),100);assert.deepEqual(getFeeRecords(),[])
})

test('同账号撤权后旧请求失败不能覆盖新范围的财务提示',async t=>{
  const {s,user}=environment(t);let reject!:(cause:Error)=>void
  globalThis.fetch=async()=>new Promise((_resolve,no)=>{reject=no})
  const read=refreshBillingFromErp('TKL9001');while(!reject)await new Promise(resolve=>setImmediate(resolve))
  s.setItem('oms-auth-session',JSON.stringify({token:'virtual-token',user:{...user,permissions:[]}}))
  hydrateBilling({creditBalance:0,feeRecords:[],readWarning:'当前账号已无账务权限'})
  reject(Error('NetworkError'));await assert.rejects(read)
  assert.match(billingWarning(),/当前账号已无账务权限/);assert.doesNotMatch(billingWarning(),/保留上次结果/)
})

test('旧读取失败晚于新读取成功时不能重新显示过期失败提示',async t=>{
  environment(t);let reject!:(cause:Error)=>void;let calls=0
  globalThis.fetch=async()=>++calls===1?new Promise((_resolve,no)=>{reject=no}):Response.json(snapshot(20))
  const old=refreshBillingFromErp('TKL9001');while(!reject)await new Promise(resolve=>setImmediate(resolve))
  await refreshBillingFromErp('TKL9001');reject(Error('NetworkError'));await assert.rejects(old)
  assert.equal(getCreditBalance(),20);assert.equal(billingWarning(),'<p></p>')
})
test('并发读取旧响应晚到，不能把最新余额回退',async t=>{
  environment(t);const releases:((response:Response)=>void)[]=[];globalThis.fetch=async()=>new Promise(resolve=>{releases.push(resolve)})
  const old=refreshBillingFromErp('TKL9001'), latest=refreshBillingFromErp('TKL9001')
  while(releases.length<2)await new Promise(resolve=>setImmediate(resolve))
  releases[1](Response.json(snapshot(20)));await latest;releases[0](Response.json(snapshot(10)))
  await assert.rejects(old,/已有更新/);assert.equal(getCreditBalance(),20)
})
for(const data of [{...snapshot(),customerCode:'OTHER'},{...snapshot(),bills:null}])test('账务返回客户或范围错误时不应用不完整结果',async t=>{
  environment(t);globalThis.fetch=async()=>Response.json(data)
  await assert.rejects(refreshBillingFromErp('TKL9001'),/不完整/);assert.equal(getCreditBalance(),100)
})
test('旧本地预扣和退款入口不再调整财务或发送写请求',async t=>{
  environment(t);globalThis.fetch=async()=>{throw Error('不应发送请求')}
  assert.equal((await preDeductOutboundFees('DO-1',[])).ok,false);await assert.rejects(rollbackPreDeductOutboundFees('DO-1'),/出库单撤回或取消/);assert.equal(getCreditBalance(),100)
})
test('充值使用持久原单并读取最新账务，不把早到余额覆盖最新余额',async t=>{
  environment(t);const calls:string[]=[]
  globalThis.fetch=async(input,init)=>{calls.push(String(input));if(init?.method==='POST'){const body=JSON.parse(String(init.body));assert.match(body.rechargeNo,/^RC-/);return Response.json({customerCode:'TKL9001',balance:105,record:{rechargeNo:body.rechargeNo,amount:5,paymentMethod:'bank',status:'confirmed',createdAt:'2026-10-23'}})}return Response.json(snapshot(102))}
  assert.equal((await rechargeViaErp({customerCode:'TKL9001',amount:5})).ok,true);assert.equal(getCreditBalance(),102);assert.deepEqual(calls,['/api/erp/customers/TKL9001/recharge','/api/erp/customers/TKL9001/billing-snapshot'])
})

test('出库对账预扣、实扣、差额只计算一次最终费用，取消退还净额为零',()=>{
  const no='DOTKL9001-261023-0021',record=(id:string,amount:number,method:FeeRecord['method']):FeeRecord=>({id,date:'2026-10-23',type:'handling',refNo:no,desc:'阶段核对',amount,method})
  assert.equal(groupFeeRecordsByOutbound([record('pre',-10,'pre_deduct'),record('fee',-41.2,'actual'),record('settle-1',-31.2,'settlement_adjust')])[0].netChange,-41.2)
  assert.equal(groupFeeRecordsByOutbound([record('pre',-10,'pre_deduct'),record('refund-1',10,'settlement_adjust')])[0].netChange,0)
  assert.equal(groupFeeRecordsByOutbound([record('pre',-10,'pre_deduct')])[0].netChange,-10)
})

test('充值成功后账务读取失败即使返回400，也保留原单供精确重试',async t=>{
  environment(t);const bodies:unknown[]=[];let failRead=true
  globalThis.fetch=async(_input,init)=>{
    if(init?.method==='POST'){const body=JSON.parse(String(init.body));bodies.push(body);return Response.json({customerCode:'TKL9001',balance:105,record:{rechargeNo:body.rechargeNo,amount:5}})}
    if(failRead)return Response.json({message:'暂时无法读取账务'},{status:400})
    return Response.json(snapshot(103))
  }
  assert.equal((await rechargeViaErp({customerCode:'TKL9001',amount:5})).ok,false)
  assert.equal(pendingRecharge()?.amount,5)
  assert.equal((await rechargeViaErp({customerCode:'TKL9001',amount:8})).ok,false);assert.equal(bodies.length,1)
  failRead=false;assert.equal((await rechargeViaErp({customerCode:'TKL9001',amount:99},true)).ok,true)
  assert.deepEqual(bodies[0],bodies[1]);assert.equal(pendingRecharge(),null);assert.equal(getCreditBalance(),103)
  assert.equal((await rechargeViaErp({customerCode:'TKL9001',amount:99},true)).ok,false);assert.equal(bodies.length,2)
})
test('已到账但待同步时页面保留原单，不允许修改金额另建单',async t=>{
  environment(t)
  globalThis.fetch=async(_input,init)=>init?.method==='POST'?Response.json({customerCode:'TKL9001',balance:105,syncPending:true,record:{rechargeNo:JSON.parse(String(init.body)).rechargeNo,amount:5}}):Response.json(snapshot(105))
  const result=await rechargeViaErp({customerCode:'TKL9001',amount:5});assert.ok(result.ok&&result.pending);assert.equal(pendingRecharge()?.amount,5)
  assert.equal((await rechargeViaErp({customerCode:'TKL9001',amount:6})).ok,false)
})
