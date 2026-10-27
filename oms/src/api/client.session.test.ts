import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { apiGet, authSessionScope, fetchWithAuth, getStoredAuthSession, storeAuthSession, type AuthSession } from './client'
import { currentProductWriteScope, requireProductWriteScope } from '../auth/productAccess'

const user: AuthSession['user']={id:'one',username:'one',email:'',name:'隔离客户',role:'hybrid',status:'active',customerId:'c1',customerCode:'TKL9001',
  permissions:['product:read','product:write'],mustChangePassword:false,type:'hybrid',warehouse:'jhb1'}
function setup(t:TestContext) {
  const keys=['localStorage','sessionStorage','window'] as const
  const descriptors=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const),originalFetch=globalThis.fetch
  const storage=()=>{const rows=new Map<string,string>();return {getItem:(key:string)=>rows.get(key)||null,setItem:(key:string,value:string)=>rows.set(key,value),removeItem:(key:string)=>rows.delete(key)}}
  for(const key of ['localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{configurable:true,value:storage()})
  const events=new EventTarget();Object.defineProperty(globalThis,'window',{configurable:true,value:events})
  storeAuthSession({token:'old-token',user})
  t.after(()=>{globalThis.fetch=originalFetch;for(const[key,value]of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key)}})
  return events
}
test('an old request 401 cannot log out a replacement login, for JSON and authenticated fetch',async t=>{
  setup(t)
  for(const raw of [false,true]) {
    storeAuthSession({token:'old-token',user});let resolve!:(value:Response)=>void
    globalThis.fetch=async()=>new Promise(r=>resolve=r)
    const run=raw?fetchWithAuth('/api/download'):apiGet('/inventory-state')
    storeAuthSession({token:'new-token',user:{...user,id:'two',customerId:'c2'}})
    resolve(Response.json({error:'登录已失效'},{status:401}))
    if(raw)await run;else await assert.rejects(run)
    assert.equal(getStoredAuthSession()?.token,'new-token')
  }
})
test('current-session 401 clears the session; current 403 requests read-only permission verification',async t=>{
  const events=setup(t);let unauthorized=0,stale=0
  events.addEventListener('oms:unauthorized',()=>unauthorized++);events.addEventListener('oms:access-stale',()=>stale++)
  globalThis.fetch=async()=>Response.json({error:'没有此项操作权限'},{status:403})
  await assert.rejects(apiGet('/inventory-state'));assert.equal(stale,1);assert.ok(getStoredAuthSession())
  globalThis.fetch=async()=>Response.json({error:'登录已失效'},{status:401})
  await assert.rejects(apiGet('/inventory-state'));assert.equal(unauthorized,1);assert.equal(getStoredAuthSession(),null)
})
test('same-token permission changes invalidate a late successful response and product write scope',async t=>{
  setup(t);let resolve!:(value:Response)=>void
  const before=authSessionScope();assert.ok(currentProductWriteScope())
  globalThis.fetch=async()=>new Promise(r=>resolve=r)
  const pending=apiGet('/inventory-state')
  storeAuthSession({token:'old-token',user:{...user,permissions:['product:read']}})
  assert.notEqual(authSessionScope(),before);assert.equal(currentProductWriteScope(),null);assert.throws(requireProductWriteScope,/没有商品维护权限/)
  resolve(Response.json({private:'old data'}));await assert.rejects(pending,/权限已变化/)
})
test('stable permission ordering does not invalidate equivalent data scope',t=>{
  setup(t);const first=authSessionScope()
  storeAuthSession({token:'old-token',user:{...user,permissions:[...user.permissions].reverse()}})
  assert.equal(authSessionScope(),first)
})
test('late old-token forbidden responses cannot refresh a replacement login',async t=>{
  const events=setup(t);let stale=0,resolve!:(value:Response)=>void
  events.addEventListener('oms:access-stale',()=>stale++)
  globalThis.fetch=async()=>new Promise(r=>resolve=r)
  const pending=apiGet('/bootstrap')
  storeAuthSession({token:'replacement',user});resolve(Response.json({error:'没有此项操作权限'},{status:403}))
  await assert.rejects(pending);assert.equal(stale,0)
})
test('identity can change while the response body is read; old body is not returned',async t=>{
  setup(t);let resolve!:(value:string)=>void
  const response={ok:true,status:200,text:()=>new Promise<string>(r=>resolve=r)} as Response
  globalThis.fetch=async()=>response
  const pending=apiGet('/inventory-state');await Promise.resolve();await Promise.resolve()
  storeAuthSession({token:'replacement',user});resolve('{"private":"old"}')
  await assert.rejects(pending,/身份或权限已变化/)
})
test('missing cached login can clear stale UI, while a guest request cannot clear a later login',async t=>{
  const events=setup(t);let unauthorized=0
  events.addEventListener('oms:unauthorized',()=>unauthorized++)
  storeAuthSession(null);globalThis.fetch=async()=>Response.json({error:'未登录'},{status:401})
  await assert.rejects(apiGet('/bootstrap'));assert.equal(unauthorized,1)
  let resolve!:(value:Response)=>void;globalThis.fetch=async()=>new Promise(r=>resolve=r)
  const oldGuest=apiGet('/bootstrap');storeAuthSession({token:'new-login',user})
  resolve(Response.json({error:'未登录'},{status:401}));await assert.rejects(oldGuest)
  assert.equal(unauthorized,1);assert.equal(getStoredAuthSession()?.token,'new-login')
})
