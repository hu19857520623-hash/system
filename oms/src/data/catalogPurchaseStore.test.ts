import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { getInventorySnapshot, hydrateInventory, purchaseCatalogProductViaErp, getPendingCatalogPurchases } from './inventoryStore'
import { getCreditBalance, hydrateBilling } from './billingStore'
import { saveCatalogAttempt } from './catalogPurchaseWorkflow'
function environment(t: TestContext) {
  const previousFetch = globalThis.fetch, rows = new Map<string, string>()
  const s = { getItem: (key: string) => rows.get(key) || null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
  const user = { id: 'u1', username: 'buyer1', role: 'catalog', customerId: 'c1', customerCode: 'TKL9001', permissions: ['catalog:write'] }
  s.setItem('oms-auth-session', JSON.stringify({ token: 'virtual-test-token', user }))
  const descriptors = ['localStorage','sessionStorage'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:s});Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null,removeItem:()=>{}}})
  hydrateInventory({ inventory: [], products: [], purchases: [] });hydrateBilling({ creditBalance: 50, feeRecords: [] })
  t.after(() => { globalThis.fetch = previousFetch;hydrateInventory({inventory:[],products:[],purchases:[]});for (const [key,descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key) } })
  return { s, user }
}
const response = (orderNo: string) => ({ id: 1,orderNo,customerId:260,customerCode:'TKL9001',sku:'TKL-A',quantity:1,unitPrice:10,totalAmount:10,balanceBefore:50,balanceAfter:40,currentBalance:40,holdingQuantity:1,inventoryMirrorId:'csi-authoritative-test',soldQty:1,remainingStockQty:9,catalogStockPool:10,createdAt:'2026-10-23',status:'confirmed',idempotent:false })

test('真正采购Store在同步待核对后使用同一单号，恢复只替换权威持有而不做本地累加/回写', async t => {
  const { s } = environment(t), requests: Record<string,unknown>[] = [];let n = 0
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input),'/api/erp/purchase')
    const body=JSON.parse(String(init?.body));requests.push(body)
    return Response.json({ ...response(body.orderNo), idempotent:n>0, syncPending:n++===0 })
  }
  const first=await purchaseCatalogProductViaErp('TKL-A',1,'c1',10);assert.equal(first.ok,false);assert.equal(getInventorySnapshot().length,0)
  const original=getPendingCatalogPurchases('c1')[0];assert.ok(original)
  assert.equal((await purchaseCatalogProductViaErp('TKL-A',1,'c1',10)).ok,true)
  assert.equal(requests[0].orderNo,requests[1].orderNo);assert.equal(getInventorySnapshot()[0].locked,1);assert.equal(getCreditBalance(),40)
  assert.equal(getInventorySnapshot()[0].id,'csi-authoritative-test')
  saveCatalogAttempt(s,'u1',original)
  globalThis.fetch=async input=>{assert.equal(String(input),'/api/erp/purchase');return Response.json({...response(original.orderNo),idempotent:true,currentBalance:7,holdingQuantity:5,soldQty:5,remainingStockQty:5})}
  assert.equal((await purchaseCatalogProductViaErp('TKL-A',1,'c1',10)).ok,true)
  assert.equal(getInventorySnapshot().length,1);assert.equal(getInventorySnapshot()[0].locked,5);assert.equal(getCreditBalance(),7)
})

test('采购响应返回时登录客户已变化，不把旧客户余额/持有写进新会话', async t => {
  const { s, user }=environment(t);let finish!:()=>void
  globalThis.fetch=async (_input,init)=>{const body=JSON.parse(String(init?.body));return new Promise(resolve=>{finish=()=>resolve(Response.json(response(body.orderNo)))})}
  const pending=purchaseCatalogProductViaErp('TKL-A',1,'c1',10)
  while(!finish) await new Promise(resolve=>setImmediate(resolve))
  s.setItem('oms-auth-session',JSON.stringify({token:'other-virtual-token',user:{...user,id:'u2',customerId:'c2',customerCode:'TKL9002'}}));finish()
  const result=await pending;assert.equal(result.ok,false);assert.equal(getInventorySnapshot().length,0);assert.equal(getCreditBalance(),50)
})

test('接口返回另一采购单时保留原单号，不接受不匹配的成功结果', async t => {
  environment(t);globalThis.fetch=async()=>Response.json(response('CAT-OTHER'))
  const result=await purchaseCatalogProductViaErp('TKL-A',1,'c1',10)
  assert.equal(result.ok,false);assert.equal(getPendingCatalogPurchases('c1').length,1);assert.equal(getInventorySnapshot().length,0)
})
