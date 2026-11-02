import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { getStoredAuthSession, storeAuthSession } from '../api/client'
import type { InboundOrder } from './mockData'
import { hydrateAccounts } from '../auth/accountStore'
import { getInboundOrdersSnapshot, setInboundOrders } from './entityStore'
import { inboundMutationFailure, submitInboundToErp, updateInboundOnErp, withdrawInboundOrder,
  voidInboundOrder, reorderInboundOnErp, retryInboundOriginal, pendingInboundOperation, readInboundOriginal, refreshInboundsFromErp } from './inboundStore'

const draft: InboundOrder = {
  id: 'oms-one', customerId: 'c1', inboundNo: 'RV-TKL9001-001', source: '客户自发',
  inboundType: '自发头程', deliveryMethod: 'self', stockSource: 'owned', boxCount: 1,
  skuCount: 1, totalQty: 2, receivedQty: 0, status: 'draft', createdAt: '2026-10-16', warehouse: 'jhb1',
  lineItems: [{ sku: 'TKL9001-A', name: '产品一', qty: 2, boxNo: 1 }],
}
const erp = { id: 12, inboundNo: draft.inboundNo, warehouseCode: 'WMS-JHB-01', trackingNo: null,
  revision: 'a'.repeat(64),
  status: 'pending_receipt', omsStatus: 'on_the_way', totalExpectedQty: 2, totalReceivedQty: 0,
  items: [{ sku: 'TKL9001-A', expectedQty: 2, receivedQty: 0, productName: '产品一' }] }

function environment(t: TestContext) {
  const previousFetch = globalThis.fetch
  const descriptors = ['localStorage', 'sessionStorage', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const key of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, key, { configurable: true, value: { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value) }, removeItem: (name: string) => { values.delete(name) } } })
  }
  const held = new Set<string>()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (key: string, _options: unknown, fn: (lock: unknown) => unknown) => {
    if (held.has(key)) return fn(null)
    held.add(key); try { return await fn({ name: key }) } finally { held.delete(key) }
  } } } })
  storeAuthSession({ token: 'test-one', user: { id: 'u-one', username: 'test-one', role: 'hybrid', customerId: 'c1', customerCode: 'TKL9001', warehouse: 'jhb1', permissions: ['inbound:read', 'inbound:write'], status: 'active', mustChangePassword: false, name: '测试' } } as any)
  hydrateAccounts([{ id: 'c1', code: 'TKL9001', permissions: [] } as any])
  t.after(() => {
    globalThis.fetch = previousFetch
    setInboundOrders([])
    hydrateAccounts([])
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
}

test('正常提交只保存当前单据，ERP 确认后才转为在途', async t => {
  environment(t)
  const unrelated = { ...draft, id: 'other', inboundNo: 'OTHER', status: 'receiving' as const }
  setInboundOrders([draft, unrelated])
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    const path = String(input); calls.push(path)
    if (path === '/api/inbound-orders') {
      const saved = JSON.parse(String(init?.body))
      assert.equal(saved.length, 1)
      assert.equal(saved[0].status, 'on_the_way')
      return Response.json({ ok: true })
    }
    assert.equal(getInboundOrdersSnapshot()[0].status, 'draft')
    return Response.json(erp)
  }
  const result = await submitInboundToErp(draft)
  assert.equal(result.ok, true)
  assert.equal(getInboundOrdersSnapshot().find(row => row.id === draft.id)?.status, 'on_the_way')
  assert.equal(getInboundOrdersSnapshot().find(row => row.id === unrelated.id)?.status, 'receiving')
  assert.equal(calls.length, 2)
})

const mutations = [
  { name: '提交', action: submitInboundToErp, initial: 'draft', erpStatus: 'on_the_way', expected: 'on_the_way' },
  { name: '修改', action: updateInboundOnErp, initial: 'on_the_way', erpStatus: 'on_the_way', expected: 'on_the_way' },
  { name: '撤回', action: withdrawInboundOrder, initial: 'on_the_way', erpStatus: 'cancelled', expected: 'draft' },
  { name: '作废', action: voidInboundOrder, initial: 'on_the_way', erpStatus: 'cancelled', expected: 'voided' },
  { name: '重新下单', action: reorderInboundOnErp, initial: 'voided', erpStatus: 'on_the_way', expected: 'on_the_way' },
] as const
for (const mutation of mutations) test(`${mutation.name}已被 ERP 确认、OMS 回写失败时保留已完成结果和中文核对提示`, async t => {
  environment(t)
  const before = { ...draft, status: mutation.initial, ...(mutation.initial === 'draft' ? {} : { erpRevision: erp.revision }) }
  setInboundOrders([before])
  let erpCalls = 0, omsCalls = 0
  globalThis.fetch = async input => {
    if (String(input) === '/api/inbound-orders') {
      omsCalls++
      return Response.json({ error: 'Storage unavailable' }, { status: 503 })
    }
    erpCalls++
    return Response.json({ ...erp, omsStatus: mutation.erpStatus })
  }
  const result = await mutation.action(before)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.order.status, mutation.expected)
  assert.match(result.warning || '', /OMS 回写失败/)
  assert.match(result.warning || '', /重试原请求.*请勿新建重复单据/)
  assert.doesNotMatch(result.warning || '', /Storage unavailable/)
  assert.equal(getInboundOrdersSnapshot()[0].status, mutation.expected)
  assert.equal(before.status, mutation.initial)
  assert.equal(erpCalls, 1)
  assert.equal(omsCalls, 1)
})

test('ERP 明确拒绝时保留草稿，允许修改后重试', async t => {
  environment(t); setInboundOrders([draft])
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'Forbidden' }, { status: 403 }) }
  const result = await submitInboundToErp(draft)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.uncertain, false)
  assert.match(result.error, /没有权限/)
  assert.equal(getInboundOrdersSnapshot()[0].status, 'draft')
  assert.equal(calls, 1)
})

test('传输中断时不把未确认的 ERP 请求称为提交失败或自动重发', async t => {
  environment(t); setInboundOrders([draft])
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch') }
  const result = await submitInboundToErp(draft)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.uncertain, true)
  assert.match(result.error, /结果暂无法确认.*刷新核对.*请勿重复提交/)
  assert.doesNotMatch(result.error, /Failed to fetch|已保留为草稿/)
  assert.equal(calls, 1)
})

test('确认原单不存在后仅创建一次，不把其他拒绝误当成原单不存在', async t => {
  environment(t); setInboundOrders([draft])
  const calls: string[] = []
  globalThis.fetch = async input => {
    const path = String(input); calls.push(path)
    if (path.endsWith('/reactivate')) return Response.json({ error: '未找到入库单' }, { status: 404 })
    return Response.json(path === '/api/inbound-orders' ? { ok: true } : erp)
  }
  assert.equal((await submitInboundToErp(draft)).ok, true)
  assert.equal(calls.filter(path => path === '/api/erp/inbound').length, 1)
})

test('没有客户编码时不发起任何保存或提交', async t => {
  environment(t); hydrateAccounts([])
  globalThis.fetch = async () => { assert.fail('不应请求接口') }
  const result = await submitInboundToErp({ ...draft, customerId: 'unbound' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /未绑定客户编码/)
})

test('超时、网关错误及未知状态均保留结果待核对语义', () => {
  for (const status of [0, 408, 500, 502, 503, 504]) {
    const result = inboundMutationFailure(Object.assign(new Error('Request unavailable'), { status }))
    assert.equal(result.uncertain, true)
    assert.match(result.error, /刷新核对/)
    assert.doesNotMatch(result.error, /Request unavailable/)
  }
})

test('传输中断后拒绝新表单，显式重试发送原请求并采用最新仓库数量', async t => {
  environment(t)
  const original = { ...draft, status: 'on_the_way' as const, erpRevision: erp.revision }
  setInboundOrders([original])
  let calls = 0; const bodies: any[] = []
  globalThis.fetch = async (input, init) => {
    if (String(input) === '/api/inbound-orders') {
      assert.equal(JSON.parse(String(init?.body))[0].lineItems[0].qty, 7)
      return Response.json({ ok: true })
    }
    bodies.push(JSON.parse(String(init?.body))); calls++
    if (calls === 1) throw new TypeError('Failed to fetch')
    return Response.json({ ...erp, idempotent: true, revision: 'b'.repeat(64), status: 'receiving', omsStatus: 'receiving', totalExpectedQty: 7, items: [{ ...erp.items[0], expectedQty: 7 }] })
  }
  assert.equal((await updateInboundOnErp(original)).ok, false)
  assert.ok(pendingInboundOperation(original).record)
  const changed = { ...original, lineItems: [{ ...original.lineItems![0], qty: 9 }] }
  const refused = await updateInboundOnErp(changed)
  assert.equal(refused.ok, false); assert.equal(calls, 1)
  const recovered = await retryInboundOriginal(changed)
  assert.equal(recovered.ok, true); assert.deepEqual(bodies[0], bodies[1])
  if (recovered.ok) { assert.equal(recovered.order.lineItems![0].qty, 7); assert.equal(recovered.order.status, 'receiving') }
  assert.equal(pendingInboundOperation(original).record, null)
})

test('OMS 回写失败保留原请求，读取不清除，重试不生成新操作标识', async t => {
  environment(t); setInboundOrders([draft])
  let failSave = true; const bodies: string[] = []
  globalThis.fetch = async (input, init) => {
    if (String(input) === '/api/inbound-orders') return failSave ? Response.json({ error: 'Storage unavailable' }, { status: 503 }) : Response.json({ ok: true })
    if (init?.method === 'POST') bodies.push(String(init.body))
    return Response.json(erp)
  }
  const first = await submitInboundToErp(draft); assert.equal(first.ok, true)
  assert.ok(pendingInboundOperation(draft).record)
  assert.equal((await readInboundOriginal(draft)).ok, true); assert.ok(pendingInboundOperation(draft).record)
  failSave = false
  assert.equal((await retryInboundOriginal(draft)).ok, true)
  assert.equal(bodies[0], bodies[1]); assert.equal(pendingInboundOperation(draft).record, null)
})

test('新版本不能为旧表单自动放行；缺少打开时的版本不会发起请求', async t => {
  environment(t); setInboundOrders([{ ...draft, erpRevision: 'b'.repeat(64) }])
  let calls = 0
  globalThis.fetch = async (_input, init) => {
    calls++; assert.equal(JSON.parse(String(init?.body)).expectedVersion, 'a'.repeat(64))
    return Response.json({ error: '入库单已被其他操作更新，请刷新' }, { status: 409 })
  }
  const missing = await updateInboundOnErp(draft)
  assert.equal(missing.ok, false); assert.equal(calls, 0)
  assert.equal((await updateInboundOnErp({ ...draft, erpRevision: 'a'.repeat(64) })).ok, false)
  assert.equal(calls, 1); assert.equal(pendingInboundOperation(draft).record, null)
})

test('多页面操作锁阻止第二次提交，存储失败也不发送请求', async t => {
  environment(t); setInboundOrders([draft])
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
  let calls = 0
  globalThis.fetch = async input => {
    if (String(input) === '/api/inbound-orders') return Response.json({ ok: true })
    calls++; entered(); await gate; return Response.json(erp)
  }
  const first = submitInboundToErp(draft); await started
  const second = await submitInboundToErp(draft)
  assert.equal(second.ok, false); if (!second.ok) assert.equal(second.uncertain, false)
  assert.equal(calls, 1); release(); await first
  const set = localStorage.setItem
  localStorage.setItem = () => { throw Error('quota') }
  const failed = await submitInboundToErp({ ...draft, inboundNo: 'SECOND' })
  assert.equal(failed.ok, false); assert.equal(calls, 1)
  localStorage.setItem = set
})

test('回写期间切换身份，旧失败不得恢复旧缓存或清除原请求', async t => {
  environment(t); setInboundOrders([draft]); const owner = getStoredAuthSession()!
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
  globalThis.fetch = async input => {
    if (String(input) !== '/api/inbound-orders') return Response.json(erp)
    entered(); await gate; return Response.json({ error: 'Storage unavailable' }, { status: 503 })
  }
  const pending = submitInboundToErp(draft); await started
  storeAuthSession({ ...owner, token: 'another', user: { ...owner.user, id: 'u-two' } })
  const other = { ...draft, id: 'new-login', inboundNo: 'NEW-LOGIN' }; setInboundOrders([other])
  release(); assert.equal((await pending).ok, false)
  assert.deepEqual(getInboundOrdersSnapshot(), [other])
  storeAuthSession(owner); assert.ok(pendingInboundOperation(draft).record)
})

for (const role of ['ecommerce', 'catalog', 'hybrid'] as const) test(`${role}: 撤销入库写权限后所有客户端写入口拒绝且保留原请求`, async t => {
  environment(t); setInboundOrders([draft])
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  await submitInboundToErp(draft)
  const original = pendingInboundOperation(draft).record; assert.ok(original)
  const session = getStoredAuthSession()!; storeAuthSession({ ...session, user: { ...session.user, role, permissions: ['inbound:read'] } })
  globalThis.fetch = async () => { assert.fail('只读账号不得发起写请求') }
  for (const action of [submitInboundToErp, updateInboundOnErp, withdrawInboundOrder, voidInboundOrder, reorderInboundOnErp, retryInboundOriginal]) {
    const order = { ...draft, erpRevision: erp.revision, status: (action === reorderInboundOnErp ? 'voided' : 'on_the_way') as InboundOrder['status'] }
    const result = await action(order); assert.equal(result.ok, false)
    if (!result.ok) { assert.equal(result.uncertain, false); assert.match(result.error, /入库查看权限/) }
  }
  assert.deepEqual(pendingInboundOperation(draft).record, original)
  globalThis.fetch = async () => Response.json(erp)
  assert.equal((await readInboundOriginal(draft)).ok, true)
  assert.deepEqual(pendingInboundOperation(draft).record, original)
})

test('列表刷新等待期间离页，旧读取不能覆盖当前入库缓存', async t => {
  environment(t); setInboundOrders([draft])
  let current = true, release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = async () => { entered(); await gate; return Response.json({ items: [{ ...erp, totalExpectedQty: 99 }], total: 1 }) }
  const request = refreshInboundsFromErp('c1', () => current); await started
  const latest = { ...draft, totalQty: 3 }; setInboundOrders([latest]); current = false; release()
  assert.equal(await request, 0); assert.deepEqual(getInboundOrdersSnapshot(), [latest])
})

test('已撤回草稿确认作废后采用 voided，而不被旧 draft 表示覆盖', async t => {
  environment(t)
  const withdrawn = { ...draft, erpRevision: erp.revision }
  setInboundOrders([withdrawn])
  let calls = 0
  globalThis.fetch = async input => {
    if (String(input) === '/api/inbound-orders') return Response.json({ ok: true })
    calls++; return Response.json({ ...erp, status: 'cancelled', omsStatus: 'voided' })
  }
  const result = await voidInboundOrder(withdrawn)
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.order.status, 'voided')
  assert.equal(getInboundOrdersSnapshot()[0].status, 'voided'); assert.equal(calls, 1)
  assert.equal(pendingInboundOperation(withdrawn).record, null)
})
