import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { getInventorySnapshot, getProductsSnapshot, hydrateInventory, refreshInventoryFromErp, updateLocalProducts, importProducts, lockStockForOutbound, rollbackStockForOutbound, permanentlyDeleteLocalProduct } from './inventoryStore'
import type { Product } from './mockData'
const row:any={id:'i1',customerId:'c1',sku:'TKL1-A',available:5,locked:2,inTransit:3,pendingShelving:1,stockSource:'owned'}
function environment(t:TestContext){
  const fetch=globalThis.fetch,descriptors=['localStorage','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
  for(const [key]of descriptors)Object.defineProperty(globalThis,key,{configurable:true,value:{getItem:()=>null,removeItem:()=>{}}})
  hydrateInventory({inventory:[],products:[],purchases:[]})
  t.after(()=>{globalThis.fetch=fetch;hydrateInventory({inventory:[],products:[],purchases:[]});for(const[key,d]of descriptors){if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key)}})
}
test('sync makes one server-authoritative POST and never writes a browser stock snapshot',async t=>{
  environment(t);let calls=0
  globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'/api/erp/customers/TKL1/inventory-sync');assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),{});return Response.json({total:1,inventory:[row],products:[]})}
  assert.equal(await refreshInventoryFromErp('c1','TKL1'),1);assert.equal(calls,1);assert.equal(getInventorySnapshot()[0].available,5)
})
test('failed atomic sync retains old stock and gives a Chinese retry message',async t=>{
  environment(t);hydrateInventory({inventory:[row],products:[],purchases:[]})
  globalThis.fetch=async()=>Response.json({error:'Storage unavailable'},{status:503})
  await assert.rejects(refreshInventoryFromErp('c1','TKL1'),/同步ERP未完成.*重试/);assert.equal(getInventorySnapshot()[0].available,5)
})
test('late sync cannot overwrite a freshly hydrated customer',async t=>{
  environment(t);let release!:(r:Response)=>void;globalThis.fetch=async()=>new Promise(r=>{release=r})
  const pending=refreshInventoryFromErp('c1','TKL1');hydrateInventory({inventory:[{...row,id:'c2-row',customerId:'c2',available:8}],products:[],purchases:[]})
  while(!release)await new Promise(r=>setImmediate(r));release(Response.json({total:1,inventory:[row],products:[]}))
  await assert.rejects(pending,/页面已变化/);assert.equal(getInventorySnapshot()[0].customerId,'c2');assert.equal(getInventorySnapshot()[0].available,8)
})
test('out of order sync, incomplete result or cross-customer result cannot replace current stock',async t=>{
  environment(t);const releases:((r:Response)=>void)[]=[];globalThis.fetch=async()=>new Promise(r=>releases.push(r))
  const first=refreshInventoryFromErp('c1','TKL1');const second=refreshInventoryFromErp('c1','TKL1')
  while(releases.length<2)await new Promise(r=>setImmediate(r));releases[1](Response.json({total:1,inventory:[{...row,available:4}],products:[]}));await second
  releases[0](Response.json({total:1,inventory:[row],products:[]}));await assert.rejects(first,/页面已变化/);assert.equal(getInventorySnapshot()[0].available,4)
  globalThis.fetch=async()=>Response.json({ok:true});await assert.rejects(refreshInventoryFromErp('c1','TKL1'),/返回范围不完整/)
  globalThis.fetch=async()=>Response.json({total:1,inventory:[{...row,customerId:'c2'}],products:[]});await assert.rejects(refreshInventoryFromErp('c1','TKL1'),/返回范围不完整/);assert.equal(getInventorySnapshot()[0].available,4)
})

const product = { id:'p1', customerId:'c1', internalSku:'TKL9001-A', customerSku:'A', name:'原商品', availableQty:5, lockedQty:2, inCatalog:false, productStatus:'draft' } as Product
test('legacy local stock mutation helpers reject without changing display or sending a snapshot',async t=>{
  environment(t);hydrateInventory({inventory:[row],products:[product],purchases:[]})
  globalThis.fetch=async()=>{throw new Error('Unexpected request')}
  assert.equal((await lockStockForOutbound([{sku:row.sku,qty:1}],'owned','c1')).ok,false)
  await assert.rejects(rollbackStockForOutbound([{sku:row.sku,qty:1}],'owned','c1'),/库存由ERP维护/)
  assert.equal(getInventorySnapshot()[0].available,5);assert.equal(getInventorySnapshot()[0].locked,2)
})
test('failed deletion or a late deletion result cannot roll back another hydrated customer',async t=>{
  environment(t);hydrateInventory({inventory:[],products:[{...product,productStatus:'discarded'}],purchases:[]})
  let release!:(r:Response)=>void;globalThis.fetch=async()=>new Promise(r=>release=r)
  const pending=permanentlyDeleteLocalProduct('p1');assert.equal(getProductsSnapshot().length,1)
  hydrateInventory({inventory:[{...row,customerId:'c2'}],products:[{...product,id:'p2',customerId:'c2'}],purchases:[]})
  release(new Response(null,{status:204}));await assert.rejects(pending,/页面已变化/);assert.equal(getProductsSnapshot()[0].id,'p2');assert.equal(getInventorySnapshot()[0].customerId,'c2')
})
test('bulk metadata save sends selected cards once, omits stock and applies canonical records only after success',async t=>{
  environment(t);hydrateInventory({inventory:[row],products:[product,{...product,id:'p2',customerSku:'B',internalSku:'TKL9001-B'}],purchases:[]})
  let release!:(r:Response)=>void,calls=0
  globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'/api/inventory-products');const body=JSON.parse(String(init?.body));assert.equal(body.products.length,2);for(const p of body.products){assert.equal('availableQty' in p,false);assert.equal('lockedQty' in p,false);assert.equal('inCatalog' in p,false)}return new Promise(r=>release=r)}
  const pending=updateLocalProducts(['p1','p2'],{name:'新商品',availableQty:999})
  assert.equal(getProductsSnapshot()[0].name,'原商品');assert.equal(calls,1)
  release(Response.json({ok:true,products:getProductsSnapshot().map(p=>({...p,name:'服务端商品'}))}))
  assert.equal(await pending,2);assert.equal(getProductsSnapshot()[0].availableQty,5);assert.equal(getProductsSnapshot()[0].name,'服务端商品');assert.equal(getInventorySnapshot()[0].available,5)
})
test('failed metadata save cannot roll back a concurrent successful stock refresh',async t=>{
  environment(t);hydrateInventory({inventory:[row],products:[product],purchases:[]})
  let reject!:(e:Error)=>void
  globalThis.fetch=async(input)=>String(input).includes('inventory-products')?new Promise((_r,j)=>reject=j):Response.json({total:1,inventory:[{...row,available:3}],products:[{...product,availableQty:3}]})
  const pending=updateLocalProducts(['p1'],{name:'未保存'});await refreshInventoryFromErp('c1','TKL9001')
  reject(new Error('Network failure'));await assert.rejects(pending);assert.equal(getInventorySnapshot()[0].available,3);assert.equal(getProductsSnapshot()[0].availableQty,3);assert.equal(getProductsSnapshot()[0].name,'原商品')
})
test('late metadata result cannot replace a newly hydrated customer and imports add only server-confirmed zero stock cards',async t=>{
  environment(t);hydrateInventory({inventory:[row],products:[product],purchases:[]})
  let release!:(r:Response)=>void;globalThis.fetch=async()=>new Promise(r=>release=r)
  const pending=updateLocalProducts(['p1'],{name:'过期'});hydrateInventory({inventory:[],products:[{...product,id:'p2',customerId:'c2'}],purchases:[]})
  release(Response.json({ok:true,products:[{...product,name:'过期'}]}));await assert.rejects(pending,/页面已变化/);assert.equal(getProductsSnapshot()[0].customerId,'c2')
  hydrateInventory({inventory:[],products:[],purchases:[]})
  globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));return Response.json({ok:true,products:body.products.map((p:Product)=>({...p,availableQty:0,lockedQty:0,inCatalog:false}))})}
  assert.deepEqual(await importProducts([{...product,availableQty:999}],{customerCode:'TKL9001',customerId:'c1'}),{ok:true,count:1});assert.equal(getProductsSnapshot()[0].availableQty,0)
})
