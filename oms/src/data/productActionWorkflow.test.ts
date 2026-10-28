import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProductAction, clearProductAction, productActionScope, readProductAction, runProductAction, storeProductAction, type ActionActor } from './productActionWorkflow'
import type { Product } from './mockData'

const actor:ActionActor={id:'u1',role:'hybrid',customerId:'c1'}
const product={id:'p1',customerId:'c1',internalSku:'TKL1-A',customerSku:'A',name:'原商品',productStatus:'draft',inCatalog:false,availableQty:8,lockedQty:2} as Product
const create=()=>buildProductAction({action:'discard',products:[product]},actor)
function storage(){const rows=new Map<string,string>();return {rows,getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v)},removeItem:(k:string)=>{rows.delete(k)}}}

test('action requests carry IDs and original metadata revisions, never a replacement product snapshot',()=>{
 const a=create();assert.deepEqual(Object.keys(a.items[0]).sort(),['customerId','expected','id']);assert.equal(a.items[0].expected.includes('原商品'),true)
 const changedStock=buildProductAction({action:'discard',products:[{...product,availableQty:100,lockedQty:90}]},actor)
 assert.equal(a.items[0].expected,changedStock.items[0].expected)
})
test('account-scoped users cannot select other owners/catalog; admin bulk operations retain each customer',()=>{
 for(const products of [[{...product,customerId:'c2'}],[{...product,inCatalog:true}],[product,product]])assert.throws(()=>buildProductAction({action:'approve',products},actor),/当前客户|重复/)
 const a=buildProductAction({action:'approve',products:[product,{...product,id:'p2',customerId:'c2'}]},{id:'admin',role:'sys_admin',customerId:null})
 assert.deepEqual(a.items.map(p=>p.customerId),['c1','c2']);assert.notEqual(a.scope,productActionScope(actor))
 assert.throws(()=>buildProductAction({action:'approve',products:Array.from({length:501},(_,i)=>({...product,id:String(i)}))},actor),/500/)
})
test('unresolved action survives reload and cannot be replaced, cleared by another request or seen by another identity',()=>{
 const s=storage(),a=create();storeProductAction(s,actor,a);assert.deepEqual(readProductAction(s,actor),a)
 assert.equal(readProductAction(s,{...actor,id:'u2'}),null);assert.equal(readProductAction(s,{...actor,customerId:'c2'}),null)
 assert.throws(()=>storeProductAction(s,actor,create()),/原商品操作待核对/)
 assert.throws(()=>clearProductAction(s,actor,{...a,requestId:crypto.randomUUID()}),/已变化/)
 clearProductAction(s,actor,a);assert.equal(readProductAction(s,actor),null)
})
test('failed storage blocks submission; corrupted action data stays present with actionable Chinese error',()=>{
 const s=storage(),a=create();assert.throws(()=>storeProductAction({...s,setItem:()=>{throw Error('quota')}},actor,a),/尚未提交/)
 storeProductAction(s,actor,a);const[k]=s.rows.keys();s.rows.set(k,'{');assert.throws(()=>readProductAction(s,actor),/无法读取/);assert.equal(s.rows.get(k),'{')
})
test('network, stale version and permission errors preserve exact original action and partial approval failures',async()=>{
 const s=storage(),a=buildProductAction({action:'approve',products:[product],failures:[{sku:'BAD',error:'请填写长宽高'}]},actor);storeProductAction(s,actor,a)
 for(const status of [0,401,403,409,500])await assert.rejects(runProductAction(async()=>{throw Object.assign(Error('NetworkError'),{status})},a,'scope',()=> 'scope'),/原商品操作已保留/)
 assert.deepEqual(readProductAction(s,actor),a)
})
test('late action responses after login/permission changes cannot confirm or clear the original action',async()=>{
 const a=create();let current:string|null='scope',release!:(v:any)=>void
 const work=runProductAction(()=>new Promise(r=>{release=r}),a,'scope',()=>current)
 current=null;release({requestId:a.requestId,status:'confirmed',action:a.action,productIds:['p1']});await assert.rejects(work,/权限已变化/)
 let calls=0;await assert.rejects(runProductAction(async()=>{calls++;throw Error()},a,'old',()=> 'new'));assert.equal(calls,0)
})
test('only exact action type, identity and product scope receipts can complete a pending action',async()=>{
 const a=create(),run=(v:any)=>runProductAction(async()=>v,a,'scope',()=> 'scope')
 for(const r of [{},{requestId:'other',status:'unknown'},{requestId:a.requestId,status:'confirmed',action:'approve',productIds:['p1']},{requestId:a.requestId,status:'confirmed',action:a.action,productIds:['other']},{requestId:a.requestId,status:'cancelled',action:a.action,productIds:['p1']}])await assert.rejects(run(r),/回执/)
 assert.equal((await run({requestId:a.requestId,status:'unknown'})).status,'unknown')
 assert.equal((await run({requestId:a.requestId,status:'confirmed',action:a.action,productIds:['p1']})).status,'confirmed')
 assert.equal((await run({requestId:a.requestId,status:'cancelled',action:a.action,productIds:[]})).status,'cancelled')
})
