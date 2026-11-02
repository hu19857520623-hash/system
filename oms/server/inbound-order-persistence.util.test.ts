import test from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { InboundIdentityError, saveInboundOrder, deleteInboundDraft } from './inbound-order-persistence.util.js'
import { assertInboundSnapshot, inboundSnapshotRevision } from './inbound-snapshot-guard.util.js'
import { readSavedInboundDrafts } from './inbound-draft-read.util.js'

const data = { customerId: 'c1', inboundNo: 'IB001', source: 'ERP回传', inboundType: '客户自发', deliveryMethod: 'self',
  stockSource: 'owned', boxCount: 1, skuCount: 1, totalQty: 2, receivedQty: 0, status: 'draft', createdAt: '2026-10-09', warehouse: 'jhb1' }
function repository(initial: { id: string; inboundNo: string; customerId: string | null }[]) {
  const rows = initial.map(row => ({ ...row }))
  const tx = { $queryRaw: async (query: TemplateStringsArray) => /snapshot_tombstone|FROM inbound_order/.test(query.join('?')) ? [] : [{ code: 'TKL9001', id: 1n }], $executeRaw: async () => 1, inboundOrder: {
    findUnique: async ({ where }: { where: { id?: string; inboundNo?: string } }) =>
      rows.find(r => where.id ? r.id === where.id : r.inboundNo === where.inboundNo) ?? null,
    upsert: async ({ where, create, update }: { where: { inboundNo: string }; create: typeof data & { id: string }; update: typeof data }) => {
      const row = rows.find(r => r.inboundNo === where.inboundNo)
      if (row) { Object.assign(row, update); return { id: row.id, inboundNo: row.inboundNo } }
      rows.push({ ...create }); return { id: create.id, inboundNo: create.inboundNo }
    },
  } } as unknown as Pick<Prisma.TransactionClient, 'inboundOrder' | '$queryRaw' | '$executeRaw'>
  return { tx, rows }
}

test('ERP and OMS aliases update one existing order and retain its database ID', async () => {
  const { tx, rows } = repository([{ id: 'original-oms-id', inboundNo: 'IB001', customerId: 'c1' }])
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await saveInboundOrder(tx, 'erp-ib-12', data, 'c1'), { id: 'original-oms-id', inboundNo: 'IB001' })
  }
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'original-oms-id')
  assert.equal((rows[0] as typeof data & { id: string }).receivedQty, 0)
})

test('a new inbound is created once and repeated saves are idempotent', async () => {
  const { tx, rows } = repository([])
  await saveInboundOrder(tx, 'new-id', data, 'c1')
  await saveInboundOrder(tx, 'new-id', data, 'c1')
  assert.equal(rows.length, 1)
})

test('a colliding number belonging to another customer cannot be overwritten', async () => {
  const { tx, rows } = repository([{ id: 'other-id', inboundNo: 'IB001', customerId: 'c2' }])
  await assert.rejects(saveInboundOrder(tx, 'new-id', data, 'c1'),
    e => e instanceof InboundIdentityError && e.status === 403)
  assert.equal(rows[0].customerId, 'c2')
})

test('an existing ID cannot be moved onto a different document number', async () => {
  const { tx, rows } = repository([{ id: 'new-id', inboundNo: 'IB002', customerId: 'c1' }])
  await assert.rejects(saveInboundOrder(tx, 'new-id', data, 'c1'),
    e => e instanceof InboundIdentityError && e.status === 409)
  assert.equal(rows[0].inboundNo, 'IB002')
})

function deletionFixture(status = 'draft', linked = false) {
  let row: any = { ...data, id: 'draft-id', customerId: 'c1', status, receivedQty: 0 }
  const events: string[] = [], deleted = new Set<string>()
  const tx: any = { $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
    const sql = query.join('?'); events.push(sql)
    if (sql.includes('snapshot_tombstone')) return deleted.has('inbound_deleted') ? [{ entity_id: values[0] }] : []
    if (sql.includes('FROM oms_customeraccount')) return [{ code: 'TKL9001' }]
    if (sql.includes('FROM inbound_order')) return linked ? [{ id: 1n }] : []
    return [{ id: 1n }]
  }, $executeRaw: async () => { deleted.add('inbound_deleted'); events.push('tombstone'); return 3 },
    inboundOrder: { findUnique: async () => row, delete: async () => { row = null; events.push('delete') } } }
  const db: any = { inboundOrder: tx.inboundOrder, $transaction: async (fn: any) => fn(tx) }
  return { db, tx, events, deleted, row: () => row }
}

test('删除在客户锁内重读状态，删除标记和记录属于同一事务，原客户可重复核对', async () => {
  const f = deletionFixture()
  assert.deepEqual(await deleteInboundDraft(f.db, 'draft-id', 'c1'), { ok: true, idempotent: false })
  assert.ok(f.events.findIndex(x => x.includes('FROM customer') && x.includes('FOR UPDATE')) < f.events.indexOf('tombstone'))
  assert.ok(f.events.indexOf('tombstone') < f.events.indexOf('delete')); assert.equal(f.row(), null)
  assert.deepEqual(await deleteInboundDraft(f.db, 'draft-id', 'c1'), { ok: true, idempotent: true })
})
for (const status of ['on_the_way', 'receiving', 'shelved', 'voided']) test(`${status} 不可删除，不能清除历史`, async () => {
  const f = deletionFixture(status); await assert.rejects(deleteInboundDraft(f.db, 'draft-id', 'c1'), /仅未提交/)
  assert.equal(f.deleted.size, 0); assert.ok(f.row())
})
test('草稿已有 ERP 关联或实收数量不能删除；跨客户无法删除', async () => {
  const linked = deletionFixture('draft', true)
  await assert.rejects(deleteInboundDraft(linked.db, 'draft-id', 'c1'), /关联 ERP 入库历史/)
  const received = deletionFixture(); received.row().receivedQty = 1
  await assert.rejects(deleteInboundDraft(received.db, 'draft-id', 'c1'), /仅未提交/)
  const foreign = deletionFixture()
  await assert.rejects(deleteInboundDraft(foreign.db, 'draft-id', 'c2'), /当前客户/)
  assert.equal(linked.deleted.size + received.deleted.size + foreign.deleted.size, 0)
})
test('旧标签页保存不能绕过锁后的删除标记恢复草稿', async () => {
  const f = deletionFixture(); await deleteInboundDraft(f.db, 'draft-id', 'c1')
  await assert.rejects(saveInboundOrder(f.tx, 'new-alias', data, 'c1'), /入库草稿已删除/)
})

function linkedSnapshot(status = 'pending_receipt') {
  const header = { id: 12n, inboundNo: 'IB001', status, updatedAt: new Date('2026-11-02T04:00:00Z'), remark: null, warehouseCode: 'WMS-JHB-01', trackingNo: null, omsCustomerCode: 'TKL9001' }
  const items = [{ id: 21n, sku: 'A', expectedQty: 2, actualQty: 0 }]
  const revision = inboundSnapshotRevision(header, items)
  const trusted: any = { inboundNo: 'IB001', revision, inboundType: data.inboundType, deliveryMethod: data.deliveryMethod, source: data.source }
  const events: string[] = []
  const tx: any = { $queryRaw: async (parts: TemplateStringsArray) => {
    const query = parts.join('?'); events.push(query)
    if (query.includes('FROM inbound_order WHERE')) return [header]
    if (query.includes('FROM inbound_order_item')) return items
    if (query.includes('JOIN inbound_carton_item')) return [{ sku: 'A', qty: 2, boxNo: 1 }]
    if (query.includes('FROM inbound_carton')) return [{ id: 1n, boxSeq: 1 }]
    throw Error('Unexpected test query')
  } }
  const incoming = { id: 'order1', ...data, status: 'on_the_way', lineItems: JSON.stringify([{ sku: 'A', qty: 2, boxNo: 1 }]) }
  return { tx, header, items, revision, trusted, events, incoming }
}

test('当前 ERP 快照可重复保存，使用单据行锁并核对实际箱明细', async () => {
  const f = linkedSnapshot()
  const before = structuredClone(f.incoming)
  await assertInboundSnapshot(f.tx, f.incoming, 'TKL9001', f.revision, f.trusted)
  assert.deepEqual(f.incoming, before)
  assert.match(f.events[0], /inbound_order.*FOR UPDATE/)
  assert.ok(f.events.some(query => query.includes('JOIN inbound_carton_item')))
})

for (const patch of [{ status: 'draft' }, { status: 'shelved' }, { totalQty: 99 }, { receivedQty: 1 }, { boxCount: 2 }, { skuCount: 2 }, { warehouse: 'cpt1' }, { remark: '绕过ERP直接改备注' }, { trackingNo: '伪造跟踪号' }, { lineItems: JSON.stringify([{ sku: 'A', qty: 1, boxNo: 1 }]) }, { lineItems: JSON.stringify([{ sku: 'B', qty: 2, boxNo: 1 }]) }, { lineItems: 'broken' }]) {
  test(`当前版本也不能伪造仓库状态、数量或预报资料 ${JSON.stringify(patch)}`, async () => {
    const f = linkedSnapshot()
    await assert.rejects(assertInboundSnapshot(f.tx, { ...f.incoming, ...patch }, 'TKL9001', f.revision, f.trusted), e => e instanceof InboundIdentityError && e.status === 409)
  })
}

test('已提交快照必须有当前版本，并绑定原客户和同版本的规范资料', async () => {
  const f = linkedSnapshot()
  for (const revision of [undefined, '', '0'.repeat(64)]) await assert.rejects(assertInboundSnapshot(f.tx, f.incoming, 'TKL9001', revision, f.trusted), /快照已过期/)
  await assert.rejects(assertInboundSnapshot(f.tx, f.incoming, 'OTHER', f.revision, f.trusted), e => e instanceof InboundIdentityError && e.status === 403)
  await assert.rejects(assertInboundSnapshot(f.tx, f.incoming, 'TKL9001', f.revision, { ...f.trusted, revision: '0'.repeat(64) }), /快照已过期/)
  f.items[0].id = 22n
  await assert.rejects(assertInboundSnapshot(f.tx, f.incoming, 'TKL9001', f.revision, f.trusted), /快照已过期/)
})

test('撤回草稿可暂存修改后再下单；当前在途和已有实收的单据不能套用这条路径', async () => {
  const f = linkedSnapshot('cancelled'), draft = { ...f.incoming, status: 'draft', totalQty: 99, lineItems: JSON.stringify([{ sku: 'A', qty: 99 }]) }
  await assertInboundSnapshot(f.tx, draft, 'TKL9001', f.revision, f.trusted)
  f.items[0].actualQty = 1
  await assert.rejects(assertInboundSnapshot(f.tx, draft, 'TKL9001', f.revision, f.trusted), /快照已过期/)
  const active = linkedSnapshot()
  await assert.rejects(assertInboundSnapshot(active.tx, draft, 'TKL9001', active.revision, active.trusted), /快照已过期/)
})

test('未关联 ERP 的预约仅可为未收货草稿或本地作废，不能伪造仓库作业', async () => {
  const tx: any = { $queryRaw: async () => [] }
  for (const status of ['on_the_way', 'receiving', 'partial', 'shelved']) await assert.rejects(assertInboundSnapshot(tx, { id: 'x', ...data, status }, 'TKL9001'), /尚未提交 ERP/)
  await assert.rejects(assertInboundSnapshot(tx, { id: 'x', ...data, receivedQty: 1 }, 'TKL9001'), /尚未提交 ERP/)
  for (const status of ['draft', 'voided']) await assertInboundSnapshot(tx, { id: 'x', ...data, status }, 'TKL9001')
  await assert.rejects(assertInboundSnapshot(tx, { id: 'x', ...data, totalQty: -1 }, 'TKL9001'), e => e instanceof InboundIdentityError && e.status === 400)
})

for (const [status, local, received] of [['arrived', 'receiving', 0], ['receiving', 'receiving', 1], ['pending_putaway', 'partial', 2], ['completed', 'shelved', 2], ['confirmed', 'partial', 1], ['exception', 'exception', 0], ['cancelled', 'voided', 0]] as const) {
  test(`仓库 ${status} 按实际进度保存为 ${local}`, async () => {
    const f = linkedSnapshot(status); f.items[0].actualQty = received
    await assertInboundSnapshot(f.tx, { ...f.incoming, status: local, receivedQty: received }, 'TKL9001', f.revision, f.trusted)
  })
}

function draftReader(rows?: any[]) {
  const queries: any[] = []
  const row = { ...data, id: 'saved-draft', customerId: 'c1', inboundNo: 'IB001', totalQty: 5, status: 'draft', lineItems: JSON.stringify([{ sku: 'A', name: '已保存计划', qty: 5, boxNo: 1 }]), attachments: '[]' }
  const db: any = { customerAccount: { findFirst: async (query: any) => { queries.push(query); return { id: 'c1' } } },
    inboundOrder: { findMany: async (query: any) => { queries.push(query); return rows || [row] } } }
  return { db, row, queries }
}

test('读取撤回草稿按登录客户和已取消单号过滤，返回已保存的计划而非ERP旧数量', async () => {
  const f = draftReader(), before = structuredClone(f.row)
  const result = await readSavedInboundDrafts(f.db, 'TKL9001', 'c1', ['IB001'])
  assert.equal(result.drafts[0].totalQty, 5); assert.deepEqual(result.draftReadErrors, [])
  assert.deepEqual(f.queries[0].where, { code: 'TKL9001', id: 'c1' })
  assert.deepEqual(f.queries[1].where, { customerId: 'c1', status: 'draft', inboundNo: { in: ['IB001'] } })
  assert.deepEqual(f.row, before)
})

test('无已取消单号不查询草稿；无效客户拒绝，管理员无OMS档案时仅返回空草稿', async () => {
  const f = draftReader()
  assert.deepEqual(await readSavedInboundDrafts(f.db, 'TKL9001', 'c1', []), { drafts: [], draftReadErrors: [] }); assert.equal(f.queries.length, 0)
  await assert.rejects(readSavedInboundDrafts(f.db, 'TKL9001', '', ['IB001']), e => e instanceof InboundIdentityError && e.status === 403)
  f.db.customerAccount.findFirst = async () => null
  await assert.rejects(readSavedInboundDrafts(f.db, 'TKL9001', 'c2', ['IB001']), /登录客户不一致/)
  assert.deepEqual(await readSavedInboundDrafts(f.db, 'TKL9001', null, ['IB001']), { drafts: [], draftReadErrors: [] })
})

for (const patch of [{ lineItems: 'broken' }, { lineItems: '{}' }, { attachments: '{}' }, { totalQty: 9 }, { receivedQty: 1 }, { skuCount: 9 }, { boxCount: 3 }, { lineItems: JSON.stringify([{ sku: 'A', qty: -1, boxNo: 1 }]) }]) {
  test(`损坏草稿仅报告该单，不将其改为空明细或阻止正常草稿读取 ${JSON.stringify(patch)}`, async () => {
    const f = draftReader(); const bad = { ...f.row, ...patch }, good = { ...f.row, id: 'good', inboundNo: 'IB002' }
    const reader = draftReader([bad, good]), before = structuredClone([bad, good])
    const result = await readSavedInboundDrafts(reader.db, 'TKL9001', 'c1', ['IB001', 'IB002'])
    assert.equal(result.drafts.length, 1); assert.equal(result.drafts[0].inboundNo, 'IB002')
    assert.equal(result.draftReadErrors.length, 1); assert.match(result.draftReadErrors[0].message, /已保存草稿 IB001.*保留记录/)
    assert.deepEqual([bad, good], before)
  })
}
