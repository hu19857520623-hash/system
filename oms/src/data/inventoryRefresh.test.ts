import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { getInventorySnapshot, hydrateInventory, refreshInventoryFromErp } from './inventoryStore'

const item = { id: 7, sku: 'TKL9001-A', productName: '测试商品', stockSource: 'owned', warehouseCode: 'WMS-JHB-01',
  warehouseAvailable: 2, warehouseLocked: 0, warehouseTotal: 2, inTransitQty: 3, pendingShelvingQty: 1 }
function environment(t: TestContext) {
  const previousFetch = globalThis.fetch
  const descriptors = ['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key] of descriptors) Object.defineProperty(globalThis, key, { configurable: true, value: { getItem: () => null, removeItem: () => {} } })
  hydrateInventory({ inventory: [], products: [], purchases: [] })
  t.after(() => {
    globalThis.fetch = previousFetch
    hydrateInventory({ inventory: [], products: [], purchases: [] })
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
}

test('库存刷新保留ERP可用、在途、待上架的独立数量，并等OMS持久化确认后完成', async t => {
  environment(t)
  let release!: (response: Response) => void, settled = false
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/inventory-view')) return Response.json({ items: [item], total: 1 })
    assert.equal(String(input), '/api/inventory-state')
    const saved = JSON.parse(String(init?.body)).inventory[0]
    assert.equal(saved.available, 2); assert.equal(saved.inTransit, 3); assert.equal(saved.pendingShelving, 1)
    return new Promise(resolve => { release = resolve })
  }
  const refresh = refreshInventoryFromErp('c1', 'TKL9001').then(() => { settled = true })
  while (!release) await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  release(Response.json({ ok: true })); await refresh
  assert.equal(settled, true)
})

test('刷新已有库存更新途存，包括显式零值，且不增加第二条商品记录', async t => {
  environment(t)
  let rows = [item]
  globalThis.fetch = async input => Response.json(String(input).endsWith('/inventory-view') ? { items: rows, total: 1 } : { ok: true })
  await refreshInventoryFromErp('c1', 'TKL9001')
  rows = [{ ...item, inTransitQty: 0, pendingShelvingQty: 0 }]
  await refreshInventoryFromErp('c1', 'TKL9001')
  assert.equal(getInventorySnapshot().length, 1)
  assert.equal(getInventorySnapshot()[0].inTransit, 0)
  assert.equal(getInventorySnapshot()[0].pendingShelving, 0)
})

test('ERP读取成功但OMS回写失败时拒绝成功反馈，保留已读取结果和中文核对说明', async t => {
  environment(t)
  globalThis.fetch = async input => String(input).endsWith('/inventory-view')
    ? Response.json({ items: [item], total: 1 }) : Response.json({ error: 'Storage unavailable' }, { status: 503 })
  await assert.rejects(refreshInventoryFromErp('c1', 'TKL9001'), /ERP 库存已读取，但 OMS 保存失败，请刷新核对。服务暂时不可用/)
  assert.equal(getInventorySnapshot()[0].inTransit, 3)
  assert.equal(getInventorySnapshot()[0].available, 2)
})
