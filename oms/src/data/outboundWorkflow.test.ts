import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { hydrateAccounts } from '../auth/accountStore'
import { addOutboundOrderOrThrow, applyErpOutboundToLocal, getOutboundOrders, hydrateOutbound, refreshOutboundsFromErp, submitOutboundWorkflow } from './outboundStore'
import type { OutboundOrder } from './mockData'

const draft: OutboundOrder = { id: 'audit-ob', customerId: 'c1', outboundNo: 'DOTKL9001-261019-0001',
  source: 'platform_order', stockSource: 'owned', type: 'dropship', warehouse: 'jhb1', items: 1,
  totalQty: 2, status: 'draft', destination: '测试地址', createdAt: '2026-10-19',
  preDeductTotal: 10, preDeductFees: [{ type: 'outbound_handling', label: '出库操作费', amount: 10, detail: '测试计费' }],
  lineItems: [{ sku: 'TKL9001-A', name: '测试商品', qty: 2 }],
}
const confirmed = { id: 21, outboundNo: draft.outboundNo, status: 'pending_pick', omsStatus: 'locked',
  stockSource: 'owned', warehouseCode: 'WMS-JHB-01', items: [{ sku: 'TKL9001-A', productName: '测试商品', qty: 2 }] }

function environment(t: TestContext) {
  const previousFetch = globalThis.fetch
  const descriptors = ['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key] of descriptors) Object.defineProperty(globalThis, key, { configurable: true, value: { getItem: () => null, removeItem: () => {} } })
  hydrateAccounts([{ id: 'c1', code: 'TKL9001', permissions: [] } as any])
  hydrateOutbound([draft])
  t.after(() => {
    globalThis.fetch = previousFetch; hydrateOutbound([]); hydrateAccounts([])
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
}

test('ERP事务负责库存与费用，OMS只保存待确认请求及确认结果，不先锁镜像或扣镜像余额', async t => {
  environment(t)
  hydrateOutbound([draft, { ...draft, id: 'other', outboundNo: 'OTHER', status: 'shipped' }])
  const calls: string[] = [], states: string[] = []
  globalThis.fetch = async (input, init) => {
    const path = String(input); calls.push(path)
    if (path === '/api/outbound-orders') {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.length, 1); assert.equal(body[0].outboundNo, draft.outboundNo)
      states.push(body[0].status)
      return Response.json({ ok: true })
    }
    assert.equal(path, '/api/erp/outbound')
    assert.equal(getOutboundOrders()[0].status, 'pending')
    assert.equal(JSON.parse(String(init?.body)).preDeduct.preDeductTotal, 10)
    return Response.json(confirmed)
  }
  const result = await submitOutboundWorkflow(draft)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['/api/outbound-orders', '/api/erp/outbound', '/api/outbound-orders'])
  assert.deepEqual(states, ['pending', 'locked'])
  assert.equal(getOutboundOrders().find(row => row.id === 'other')?.status, 'shipped')
})

for (const status of [400, 403, 422]) test(`ERP明确拒绝${status}时保留同单号草稿供修改，不释放任何已确认ERP资源`, async t => {
  environment(t)
  const calls: string[] = []
  globalThis.fetch = async input => {
    calls.push(String(input))
    return String(input) === '/api/erp/outbound' ? Response.json({ error: '商品暂不可发货' }, { status }) : Response.json({ ok: true })
  }
  const result = await submitOutboundWorkflow(draft)
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.uncertain, false); assert.match(result.error, /商品暂不可发货/) }
  assert.equal(getOutboundOrders()[0].status, 'draft')
  assert.deepEqual(calls, ['/api/outbound-orders', '/api/erp/outbound', '/api/outbound-orders'])
})

for (const status of [0, 408, 409, 503]) test(`ERP结果不确定${status}时保留待确认请求，不回草稿或执行库存/费用回滚`, async t => {
  environment(t)
  const calls: string[] = []
  globalThis.fetch = async input => {
    const path = String(input); calls.push(path)
    if (path === '/api/outbound-orders') return Response.json({ ok: true })
    assert.equal(path, '/api/erp/outbound')
    if (!status) throw new TypeError('Failed to fetch')
    return Response.json({ error: 'Storage unavailable' }, { status })
  }
  const result = await submitOutboundWorkflow(draft)
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.uncertain, true); assert.match(result.error, /结果暂无法确认.*请勿重复提交/) }
  assert.equal(getOutboundOrders()[0].status, 'pending')
  assert.deepEqual(calls, ['/api/outbound-orders', '/api/erp/outbound'])
})

test('ERP已接单但OMS回写503时返回部分成功，保留已锁定状态并禁止错误回滚', async t => {
  environment(t)
  let saves = 0
  globalThis.fetch = async input => {
    if (String(input) === '/api/erp/outbound') return Response.json(confirmed)
    assert.equal(String(input), '/api/outbound-orders')
    return ++saves === 1 ? Response.json({ ok: true }) : Response.json({ error: 'Storage unavailable' }, { status: 503 })
  }
  const result = await submitOutboundWorkflow(draft)
  assert.equal(result.ok, true)
  if (result.ok) assert.match(result.warning || '', /已提交 ERP，但 OMS 回写失败.*请勿重复提交/)
  assert.equal(getOutboundOrders()[0].status, 'locked')
  assert.equal(saves, 2)
})

test('请求记录无法保存时不发送ERP，不触碰库存及费用', async t => {
  environment(t)
  const calls: string[] = []
  globalThis.fetch = async input => { calls.push(String(input)); return Response.json({ error: 'Storage unavailable' }, { status: 503 }) }
  const result = await submitOutboundWorkflow(draft)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /尚未发送 ERP/)
  assert.deepEqual(calls, ['/api/outbound-orders'])
  assert.equal(getOutboundOrders()[0].status, 'draft')
})

test('明确拒绝后的草稿回写失败时保留待核对，不能指导重复提交', async t => {
  environment(t)
  let saves = 0
  globalThis.fetch = async input => String(input) === '/api/erp/outbound'
    ? Response.json({ error: '库存不足' }, { status: 400 })
    : ++saves === 1 ? Response.json({ ok: true }) : Response.json({ error: 'Storage unavailable' }, { status: 503 })
  const result = await submitOutboundWorkflow(draft)
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.uncertain, true); assert.match(result.error, /草稿恢复未确认/) }
  assert.equal(getOutboundOrders()[0].status, 'pending')
})

test('草稿保存失败不会撤销等待期间ERP刷新的同单据状态', async t => {
  environment(t)
  let rejectSave!: (response: Response) => void
  globalThis.fetch = async () => new Promise(resolve => { rejectSave = resolve })
  const saving = addOutboundOrderOrThrow({ ...draft, remark: '编辑中的备注' })
  applyErpOutboundToLocal({ ...confirmed, omsStatus: 'picking' } as any, draft, { persist: false })
  rejectSave(Response.json({ error: 'Storage unavailable' }, { status: 503 }))
  await assert.rejects(saving)
  assert.equal(getOutboundOrders()[0].status, 'picking')
})

test('ERP记录刷新只批量保存本次返回记录，等待回写确认并保留其他草稿', async t => {
  environment(t)
  hydrateOutbound([draft, { ...draft, id: 'unrelated', outboundNo: 'UNRELATED', status: 'draft' }])
  let release!: (response: Response) => void, settled = false
  globalThis.fetch = async (input, init) => {
    const path = String(input)
    if (path === '/api/erp/outbound/by-customer/TKL9001') return Response.json({ items: [confirmed, { ...confirmed, id: 22, outboundNo: 'SECOND' }], total: 2 })
    assert.equal(path, '/api/outbound-orders')
    assert.deepEqual(JSON.parse(String(init?.body)).map((row: OutboundOrder) => row.outboundNo), [draft.outboundNo, 'SECOND'])
    return new Promise(resolve => { release = resolve })
  }
  const refresh = refreshOutboundsFromErp('c1').then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(typeof release, 'function')
  release(Response.json({ error: 'Storage unavailable' }, { status: 503 }))
  await assert.rejects(refresh, /ERP 出库记录已读取，但 OMS 保存失败/)
  assert.equal(getOutboundOrders().find(row => row.outboundNo === 'UNRELATED')?.status, 'draft')
  assert.equal(getOutboundOrders().find(row => row.id === draft.id)?.status, 'locked')
})
