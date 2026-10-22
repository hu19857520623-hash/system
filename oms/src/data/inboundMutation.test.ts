import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { InboundOrder } from './mockData'
import { hydrateAccounts } from '../auth/accountStore'
import { getInboundOrdersSnapshot, setInboundOrders } from './entityStore'
import { inboundMutationFailure, submitInboundToErp, updateInboundOnErp, withdrawInboundOrder,
  voidInboundOrder, reorderInboundOnErp } from './inboundStore'

const draft: InboundOrder = {
  id: 'oms-one', customerId: 'c1', inboundNo: 'RV-TKL9001-001', source: '客户自发',
  inboundType: '自发头程', deliveryMethod: 'self', stockSource: 'owned', boxCount: 1,
  skuCount: 1, totalQty: 2, receivedQty: 0, status: 'draft', createdAt: '2026-10-16', warehouse: 'jhb1',
  lineItems: [{ sku: 'TKL9001-A', name: '产品一', qty: 2, boxNo: 1 }],
}
const erp = { id: 12, inboundNo: draft.inboundNo, warehouseCode: 'WMS-JHB-01', trackingNo: null,
  status: 'pending_receipt', omsStatus: 'on_the_way', totalExpectedQty: 2, totalReceivedQty: 0,
  items: [{ sku: 'TKL9001-A', expectedQty: 2, receivedQty: 0, productName: '产品一' }] }

function environment(t: TestContext) {
  const previousFetch = globalThis.fetch
  const descriptors = ['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key] of descriptors) Object.defineProperty(globalThis, key, {
    configurable: true, value: { getItem: () => null, removeItem: () => {} },
  })
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
  const before = { ...draft, status: mutation.initial }
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
  assert.match(result.warning || '', /请勿重复操作/)
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
  const result = await submitInboundToErp(draft)
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
