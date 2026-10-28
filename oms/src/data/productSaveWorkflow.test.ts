import test from 'node:test'
import assert from 'node:assert/strict'
import { comparableProductMetadata } from './productSaveContract'
import { clearProductSaveAttempt, readProductSaveAttempt, runProductSaveAttempt, storeProductSaveAttempt, type ProductSaveAttempt } from './productSaveWorkflow'
import type { Product } from './mockData'

function attempt(): ProductSaveAttempt { return { requestId: crypto.randomUUID(), userId: 'u1', customerId: 'c1', action: 'draft', mode: 'create', expected: null, product: { id: 'test-card', customerId: 'c1', name: '原保存商品', customerSku: 'S45', internalSku: 'TKL1-S45', productStatus: 'draft' } as Product } }
function storage() { const rows = new Map<string,string>(); return { rows, getItem: (key:string) => rows.get(key) ?? null, setItem: (key:string,value:string) => { rows.set(key,value) }, removeItem: (key:string) => { rows.delete(key) } } }

test('metadata revisions tolerate stock refreshes and null/undefined while detecting later edits', () => {
  const p = attempt().product, baseline = comparableProductMetadata(p)
  assert.equal(comparableProductMetadata({ ...p, availableQty: 8, lockedQty: 2, customCode: null }), baseline)
  for (const patch of [{ name: '后续编辑' }, { productStatus: 'available' }, { customerId: 'other' }, { inCatalog: true }, { customerSku: 'OTHER' }]) assert.notEqual(comparableProductMetadata({ ...p, ...patch }), baseline)
})
test('original save survives reload and is bound to actor/customer; another attempt cannot replace it', () => {
  const s = storage(), a = attempt(); storeProductSaveAttempt(s,a)
  assert.deepEqual(readProductSaveAttempt(s,'u1','c1'),a)
  assert.equal(readProductSaveAttempt(s,'u2','c1'),null);assert.equal(readProductSaveAttempt(s,'u1','c2'),null)
  assert.throws(() => storeProductSaveAttempt(s,attempt()),/原商品保存请求待核对/)
  assert.throws(() => clearProductSaveAttempt(s,{ ...a, requestId: crypto.randomUUID() }),/已变化/)
  clearProductSaveAttempt(s,a);assert.equal(readProductSaveAttempt(s,'u1','c1'),null)
})
test('storage failure stops before submission; unreadable state cannot silently become a new create', () => {
  const s = storage(), a = attempt()
  assert.throws(() => storeProductSaveAttempt({ ...s,setItem:()=>{throw Error('quota')} },a),/尚未提交/)
  storeProductSaveAttempt(s,a);const [key]=s.rows.keys();s.rows.set(key,'{')
  assert.throws(() => readProductSaveAttempt(s,'u1','c1'),/无法读取/);assert.equal(s.rows.get(key),'{')
})
test('network, revocation and stale-version errors keep the original immutable request for recovery', async () => {
  for (const status of [0,401,403,409,500]) {
    const s=storage(),a=attempt();storeProductSaveAttempt(s,a)
    await assert.rejects(runProductSaveAttempt(async()=>{throw Object.assign(Error('NetworkError'),{status})},a,'scope',()=> 'scope'),/原商品保存请求已保留/)
    assert.deepEqual(readProductSaveAttempt(s,'u1','c1'),a)
  }
})
test('late response after identity/permission switch cannot confirm or clear the original save', async () => {
  const s=storage(),a=attempt();storeProductSaveAttempt(s,a)
  let owner:string|null='scope',release!:(value:any)=>void
  const work=runProductSaveAttempt(()=>new Promise(r=>{release=r}),a,owner,()=>owner)
  owner=null;release({requestId:a.requestId,status:'confirmed',productId:a.product.id})
  await assert.rejects(work,/权限已变化/);assert.deepEqual(readProductSaveAttempt(s,'u1','c1'),a)
  let calls=0;await assert.rejects(runProductSaveAttempt(async()=>{calls++;throw Error()},a,'old',()=> 'new'));assert.equal(calls,0)
})
test('only the original request and product can confirm; unknown does not pretend to be rejected', async () => {
  const a=attempt(),run=(value:any)=>runProductSaveAttempt(async()=>value,a,'scope',()=> 'scope')
  for(const value of [{},{requestId:'other',status:'unknown'},{requestId:a.requestId,status:'confirmed',productId:'other'},{requestId:a.requestId,status:'cancelled',productId:a.product.id}]) await assert.rejects(run(value),/回执/)
  assert.equal((await run({requestId:a.requestId,status:'unknown'})).status,'unknown')
  assert.equal((await run({requestId:a.requestId,status:'confirmed',productId:a.product.id})).status,'confirmed')
  assert.equal((await run({requestId:a.requestId,status:'cancelled',productId:null})).status,'cancelled')
})
