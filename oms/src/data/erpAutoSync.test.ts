import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { syncErpNow } from './erpAutoSync'
import { storeAuthSession, type AuthSession } from '../api/client'
import { hydrateInventory } from './inventoryStore'
import { hydrateEntities, getReturnOrdersSnapshot } from './entityStore'
import { getOutboundOrders, hydrateOutbound } from './outboundStore'
import { getLogisticsRecordsSnapshot, hydrateLogistics } from './logisticsStore'

function setup(t:TestContext, permissions:string[]) {
  const originalFetch=globalThis.fetch, descriptors=['localStorage','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
  const storage=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)}}
  for(const[key]of descriptors)Object.defineProperty(globalThis,key,{configurable:true,value:storage()})
  storeAuthSession({token:'fixture-token',user:{id:'u1',username:'fixture',role:'hybrid',customerId:'c1',customerCode:'TKL9001',permissions}} as AuthSession)
  hydrateInventory({inventory:[],products:[],purchases:[]});hydrateOutbound([]);hydrateLogistics([]);hydrateEntities({orders:[],inboundOrders:[],returnOrders:[],stores:[],platformSkuMappings:[],systemMessages:[],announcements:[],billing:null} as any)
  t.after(()=>{globalThis.fetch=originalFetch;hydrateOutbound([]);hydrateLogistics([]);hydrateInventory({inventory:[],products:[],purchases:[]});hydrateEntities({orders:[],inboundOrders:[],returnOrders:[],stores:[],platformSkuMappings:[],systemMessages:[],announcements:[],billing:null} as any);for(const[key,value]of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key)}})
}
test('product/inventory reader never requests unrelated ERP histories or billing during auto refresh',async t=>{
  setup(t,['product:read','inventory:read']);const calls:string[]=[]
  globalThis.fetch=async(input,init)=>{calls.push(String(input));assert.equal(init?.method,'POST');return Response.json({customerCode:'TKL9001',total:0,inventory:[],products:[]})}
  await syncErpNow('hybrid');assert.deepEqual(calls,['/api/erp/customers/TKL9001/inventory-sync'])
})
test('no business permissions produces no automatic network requests',async t=>{
  setup(t,[]);globalThis.fetch=async()=>assert.fail('Unexpected read')
  await syncErpNow('hybrid')
})
test('read-only history refreshes update visible records without sending any persistence mutation',async t=>{
  setup(t,['inbound:read','outbound:read','returns:read','logistics:read']);const calls:string[]=[]
  globalThis.fetch=async(input,init)=>{
    assert.ok(!init?.method || init.method==='GET','History refresh must not save snapshots');const path=String(input);calls.push(path)
    if(path.includes('/inbound/'))return Response.json({total:0,items:[]})
    if(path.includes('/returns/'))return Response.json({total:1,items:[{id:3,returnNo:'RT-READ42',customerCode:'TKL9001',status:'pending_arrival',items:[]}]})
    if(path.includes('/outbound/'))return Response.json({total:1,items:[{id:4,outboundNo:'DO-READ42',customerCode:'TKL9001',status:'shipped',items:[]}]})
    if(path.includes('/logistics/'))return Response.json({total:1,items:[{id:'log42',outboundNo:'DO-READ42',status:'shipped'}]})
    return assert.fail('Unexpected endpoint '+path)
  }
  await syncErpNow('hybrid');assert.equal(calls.length,4)
  assert.ok(getReturnOrdersSnapshot().some(row=>row.returnNo==='RT-READ42'))
  assert.ok(getOutboundOrders().some(row=>row.outboundNo==='DO-READ42'))
  assert.ok(getLogisticsRecordsSnapshot().some(row=>row.id==='log42'))
})
test('a pending old customer sync cannot block the new permission scope or overwrite its records',async t=>{
  setup(t,['inventory:read']);let release!:(value:Response)=>void
  globalThis.fetch=async(input)=>{
    if(String(input).includes('/inventory-sync'))return new Promise(resolve=>release=resolve)
    assert.equal(String(input),'/api/erp/returns/by-customer/TKL9002')
    return Response.json({total:1,items:[{id:9,returnNo:'RT-C2-READ42',status:'pending_arrival',items:[]}]})
  }
  const old=syncErpNow('hybrid');while(!release)await new Promise(resolve=>setImmediate(resolve))
  storeAuthSession({token:'customer-two',user:{id:'u2',username:'two',role:'hybrid',customerId:'c2',customerCode:'TKL9002',permissions:['returns:read']}} as AuthSession)
  await syncErpNow('hybrid');assert.ok(getReturnOrdersSnapshot().some(row=>row.returnNo==='RT-C2-READ42'))
  release(Response.json({total:1,inventory:[{customerId:'c1',sku:'OLD',available:99}],products:[]}));await old
  assert.ok(getReturnOrdersSnapshot().some(row=>row.returnNo==='RT-C2-READ42'))
})
