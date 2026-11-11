import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { buildImportedInboundDrafts } from './inboundDraftImport'
import { addInboundOrdersOrThrow, cacheInboundOrder, getInboundOrdersSnapshot, setInboundOrders } from './entityStore'
import type { ParsedInboundImport } from './importTemplates'
import { storeAuthSession } from '../api/client'

const row: ParsedInboundImport = { headerKey: '很长的备注和参考号'.repeat(40),
  inboundType: '自发头程', deliveryMethod: 'self', remark: '备注'.repeat(200),
  lines: [{ sku: 'TKL9001-A', name: '产品一', qty: 2, boxNo: 1 }] }
const options = { customerId: 'c1', customerCode: 'TKL9001',
  existingNos: ['RVTKL9001-261016-0002'], date: new Date(2026, 9, 16, 12) }

test('批量草稿使用独立短标识及连续单号，不把长备注塞入记录标识', () => {
  const rows = buildImportedInboundDrafts([row, row], options)
  assert.deepEqual(rows.map(item => item.inboundNo), ['RVTKL9001-261016-0003', 'RVTKL9001-261016-0004'])
  assert.equal(new Set(rows.map(item => item.id)).size, 2)
  for (const item of rows) {
    assert.ok(item.id.length <= 50)
    assert.equal(item.status, 'draft')
    assert.equal(item.customerId, 'c1')
    assert.equal(item.remark, row.remark)
    assert.equal(item.totalQty, 2)
    assert.equal(item.createdAt, '2026-10-16')
  }
})

test('未指定客户的管理员导入在保存之前得到中文说明', () => {
  assert.throws(() => buildImportedInboundDrafts([row], { ...options, customerId: '' }), /请先选择导入客户/)
})

function environment(t: TestContext) {
  const previousFetch = globalThis.fetch
  const descriptors = ['localStorage', 'sessionStorage', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const key of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, key, { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_key: string, _options: unknown, work: any) => work({}) } } })
  storeAuthSession({ token: 'test', user: { id: 'u1', username: 'test', role: 'hybrid', customerId: 'c1', customerCode: 'TKL9001', permissions: ['inbound:read', 'inbound:write'] } } as any)
  t.after(() => {
    globalThis.fetch = previousFetch; setInboundOrders([])
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
}

test('整批只发一个保存请求并等待确认，不回写已有单据的旧状态', async t => {
  environment(t)
  const rows = buildImportedInboundDrafts([row, row], options)
  setInboundOrders([{ ...rows[0], id: 'old', inboundNo: 'OLD', status: 'receiving' }])
  let release!: (value: Response) => void
  let calls = 0, settled = false, saved: any[] = []
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  globalThis.fetch = async (input, init) => {
    calls++
    assert.equal(String(input), '/api/inbound-orders')
    saved = JSON.parse(String(init?.body))
    entered()
    assert.deepEqual(JSON.parse(String(init?.body)).map((item: any) => item.inboundNo), rows.map(item => item.inboundNo))
    return new Promise(resolve => { release = resolve })
  }
  const save = addInboundOrdersOrThrow(rows).then(() => { settled = true })
  await started
  assert.equal(settled, false)
  assert.equal(calls, 1)
  release(Response.json({ requestId: saved[0].saveRequestId, status: 'confirmed', identities: saved.map((order, index) => ({ inboundNo: order.inboundNo, id: index === 0 ? 'canonical-one' : order.id, omsRevision: 'a'.repeat(64) })) }))
  await save
  assert.equal(settled, true)
  assert.equal(getInboundOrdersSnapshot().find(item => item.inboundNo === rows[0].inboundNo)?.id, 'canonical-one')
  assert.equal(getInboundOrdersSnapshot().find(item => item.inboundNo === 'OLD')?.status, 'receiving')
})

test('保存失败撤销本批乐观草稿，保留等待期间 ERP 刷新的记录', async t => {
  environment(t)
  const rows = buildImportedInboundDrafts([row, row], options)
  const old = { ...rows[0], id: 'old', inboundNo: 'OLD', status: 'receiving' as const }
  setInboundOrders([old])
  let release!: (value: Response) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  globalThis.fetch = async () => new Promise(resolve => { release = resolve; entered() })
  const save = addInboundOrdersOrThrow(rows)
  await started
  cacheInboundOrder({ ...old, status: 'shelved' })
  release(Response.json({ error: '保存失败' }, { status: 503 }))
  await assert.rejects(save)
  assert.equal(getInboundOrdersSnapshot().length, 1)
  assert.equal(getInboundOrdersSnapshot()[0].status, 'shelved')
})

test('同一单据等待期间收到 ERP 新状态，失败回滚也不覆盖它', async t => {
  environment(t)
  const rows = buildImportedInboundDrafts([row], options)
  setInboundOrders([])
  let release!: (value: Response) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  globalThis.fetch = async () => new Promise(resolve => { release = resolve; entered() })
  const save = addInboundOrdersOrThrow(rows)
  await started
  cacheInboundOrder({ ...rows[0], status: 'on_the_way' })
  release(Response.json({ error: '保存失败' }, { status: 503 }))
  await assert.rejects(save)
  assert.equal(getInboundOrdersSnapshot()[0].status, 'on_the_way')
})
