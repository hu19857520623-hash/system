import test from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { InboundIdentityError, saveInboundOrder, deleteInboundDraft } from './inbound-order-persistence.util.js'
import { assertInboundSnapshot, inboundSnapshotRevision } from './inbound-snapshot-guard.util.js'
import { readSavedInboundDrafts } from './inbound-draft-read.util.js'
import { readInboundPlan, assertInboundInputCounts } from './inbound-plan.util.js'
import { inboundSavedVersion, runInboundSave, resolveInboundSave } from './inbound-save.util.js'
import { receiveInboundStatus } from './inbound-webhook.util.js'

const data = { customerId: 'c1', inboundNo: 'IB001', source: 'ERP回传', inboundType: '客户自发', deliveryMethod: 'self',
  stockSource: 'owned', boxCount: 1, skuCount: 1, totalQty: 2, receivedQty: 0, status: 'draft', createdAt: '2026-10-09', warehouse: 'jhb1', lineItems: JSON.stringify([{ sku: 'A', qty: 2, boxNo: 1 }]) }
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

for (const [status, local, received] of [['arrived', 'receiving', 0], ['receiving', 'receiving', 1], ['pending_putaway', 'completed', 2], ['pending_putaway', 'completed', 1], ['pending_putaway', 'completed', 0], ['completed', 'shelved', 2], ['completed', 'shelved', 1], ['confirmed', 'shelved', 1], ['exception', 'exception', 0], ['cancelled', 'voided', 0]] as const) {
  test(`仓库 ${status} 按实际进度保存为 ${local}`, async () => {
    const f = linkedSnapshot(status); f.items[0].actualQty = received
    await assertInboundSnapshot(f.tx, { ...f.incoming, status: local, receivedQty: received }, 'TKL9001', f.revision, f.trusted)
  })
}

test('清点确认待上架后，旧部分收货快照不能覆盖收货完成，也不能提前标记上架完成', async () => {
  const f = linkedSnapshot('pending_putaway')
  for (const status of ['partial', 'shelved']) {
    await assert.rejects(assertInboundSnapshot(f.tx, { ...f.incoming, status }, 'TKL9001', f.revision, f.trusted), e => e instanceof InboundIdentityError && e.status === 409)
  }
})

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

test('草稿计划校验保留原始数据，支持同SKU多箱和多个SKU同箱', () => {
  const row = { ...data, totalQty: 7, skuCount: 2, boxCount: 2, lineItems: JSON.stringify([{ sku: 'A', qty: 2, boxNo: 1 }, { sku: 'A', qty: 3, boxNo: 2 }, { sku: 'B', name: '合法品名', qty: 2, boxNo: 2 }]), attachments: JSON.stringify([{ kind: '文件', fileName: 'file.pdf', url: 'data:application/pdf;base64,QQ==', uploadedAt: '2026-11-02' }]) }
  const before = structuredClone(row), decoded = readInboundPlan(row)
  assert.equal(decoded.lineItems.length, 3); assert.equal(decoded.attachments.length, 1); assert.deepEqual(row, before)
  assert.deepEqual(readInboundPlan({ ...data, totalQty: 0, skuCount: 0, boxCount: 1, lineItems: null }), { lineItems: [], attachments: [] })
})

for (const patch of [
  { lineItems: '{}' }, { lineItems: '[null]' }, { lineItems: 'broken' },
  { lineItems: JSON.stringify([{ sku: 'A', qty: -2 }]) }, { lineItems: JSON.stringify([{ sku: 'A', qty: 2147483648 }]) },
  { lineItems: JSON.stringify([{ sku: 'A', qty: 2, name: {} }]) }, { lineItems: JSON.stringify([{ sku: 'A', qty: 2, boxNo: 0 }]) },
  { totalQty: 3 }, { skuCount: 2 }, { boxCount: 2 }, { receivedQty: 1 },
  { attachments: '{}' }, { attachments: '[null]' }, { attachments: '[{}]' },
  { attachments: JSON.stringify([{ kind: '文件', fileName: {}, url: '/api/file', uploadedAt: '2026-11-02' }]) },
  { attachments: JSON.stringify([{ kind: '文件', fileName: 'file.pdf', url: 'javascript:void(0)', uploadedAt: '2026-11-02' }]) },
  { attachments: JSON.stringify([{ kind: '文件', fileName: 'file.pdf', url: 'blob:temporary', uploadedAt: '2026-11-02' }]) },
]) test(`草稿保存拒绝无法读取、数量不一致或不安全的附件 ${JSON.stringify(patch)}`, async () => {
  const { tx, rows } = repository([]), incoming = { ...data, ...patch }, before = structuredClone(incoming)
  await assert.rejects(saveInboundOrder(tx, 'new-id', incoming, 'c1'), e => e instanceof InboundIdentityError && e.status === 400 && /[\u4e00-\u9fff]/.test(e.message))
  assert.deepEqual(incoming, before); assert.equal(rows.length, 0)
})

for (const value of [true, false, '2', -1, 1.5, 2147483648, null]) test(`入库数量在类型转换前拒绝 ${JSON.stringify(value)}`, () => {
  for (const field of ['totalQty', 'boxCount', 'skuCount']) assert.throws(() => assertInboundInputCounts({ ...data, [field]: value }), e => e instanceof InboundIdentityError && e.status === 400)
})
test('明细字段不能通过假值转换悄悄变为空列表；缺省实收仍为零', () => {
  for (const field of ['lineItems', 'attachments']) for (const value of [false, '', 0, {}]) assert.throws(() => assertInboundInputCounts({ ...data, lineItems: [], [field]: value }), InboundIdentityError)
  assert.doesNotThrow(() => assertInboundInputCounts({ ...data, lineItems: [], receivedQty: undefined }))
})
test('入库表头不能以对象或过长文本触发数据库错误，合法Unicode文本按字符计长', () => {
  for (const patch of [{ id: {} }, { inboundNo: ['IB001'] }, { warehouse: 42 }, { warehouse: null }, { createdAt: '' }, { remark: {} }, { contactPhone: '1'.repeat(51) }, { status: 'x'.repeat(31) }]) assert.throws(() => assertInboundInputCounts({ ...data, lineItems: [], ...patch }), InboundIdentityError)
  assert.doesNotThrow(() => assertInboundInputCounts({ ...data, lineItems: [], contact: '😀'.repeat(100) }))
})

function saveProtocolFixture() {
  let rows: any[] = [{ id: 'saved-id', ...data }], receipts: any[] = [], count = 0, failReceipt = false
  let tail = Promise.resolve()
  const db: any = { $transaction: (work: any) => {
    const next = tail.then(async () => {
      const before = structuredClone({ rows, receipts, count })
      const tx: any = {
        $queryRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
          const sql = parts.join('?')
          if (sql.includes('FROM oms_inbound_save')) return receipts.filter(row => row.request_id === values[0])
          if (sql.includes('FROM oms_customeraccount')) return [{ code: 'TKL9001' }]
          if (sql.includes('FROM customer')) return [{ id: 1n }]
          throw Error(sql)
        },
        $executeRaw: async (_parts: any, ...values: any[]) => {
          if (failReceipt) throw Error('receipt storage failure')
          receipts.push({ request_id: values[0], actor_id: values[1], customer_id: values[2], content_hash: values[3], status: values.length === 5 ? 'confirmed' : 'cancelled', result: values[4] || '[]' }); return 1
        },
        inboundOrder: { findUnique: async ({ where }: any) => rows.find(row => row.inboundNo === where.inboundNo) || null,
          findUniqueOrThrow: async ({ where }: any) => { const row = rows.find(row => row.inboundNo === where.inboundNo); if (!row) throw Error('missing'); return row } },
      }
      try { return await work(tx) } catch (error) { rows = before.rows; receipts = before.receipts; count = before.count; throw error }
    })
    tail = next.then(() => {}, () => {}); return next
  } }
  const save = async (_tx: any, order: any) => {
    if (order.remark === 'FAIL') throw Error('save failed')
    const old = rows.find(row => row.inboundNo === order.inboundNo)
    if (old) Object.assign(old, order, { id: old.id }); else rows.push({ ...order })
    count++;return { id: old?.id || order.id, inboundNo: order.inboundNo }
  }
  return { db, save, rows: () => rows, receipts: () => receipts, count: () => count, failReceipt: () => { failReceipt = true } }
}
const saveId = '00000000-0000-4000-8000-000000000097'
const saveId2 = '00000000-0000-4000-8000-000000000098'
test('OMS独立版本覆盖全部草稿字段，与ERP版本和字段顺序无关', () => {
  const row = { id: 'saved-id', ...data }, version = inboundSavedVersion(row)
  assert.equal(inboundSavedVersion(Object.fromEntries(Object.entries(row).reverse())), version)
  assert.equal(inboundSavedVersion({ ...row, erpRevision: 'not-part-of-oms-state' }), version)
  for (const patch of [{ totalQty: 7 }, { remark: 'new' }, { attachments: '[]' }, { lineItems: '[]' }, { status: 'voided' }]) assert.notEqual(inboundSavedVersion({ ...row, ...patch }), version)
})
test('新草稿版本保存一次，重复回执即使后续已编辑也不覆盖当前记录', async () => {
  const f = saveProtocolFixture(), expected = inboundSavedVersion(f.rows()[0]), plan = [{ expected, order: { ...f.rows()[0], totalQty: 5 } }]
  const first = await runInboundSave(f.db, saveId, 'u1', 'c1', plan, f.save)
  assert.equal(first.status, 'confirmed');assert.equal(first.replay, false);assert.equal(f.count(), 1)
  const newer = [{ expected: inboundSavedVersion(f.rows()[0]), order: { ...f.rows()[0], totalQty: 7 } }]
  await runInboundSave(f.db, saveId2, 'u1', 'c1', newer, f.save)
  const replay = await runInboundSave(f.db, saveId, 'u1', 'c1', plan, f.save)
  assert.equal(replay.replay, true);assert.equal(f.rows()[0].totalQty, 7);assert.equal(f.count(), 2)
  const result = await resolveInboundSave(f.db, saveId, 'u1', 'c1', plan, true)
  assert.equal(result.status, 'confirmed');assert.equal(f.rows()[0].totalQty, 7)
})
test('两个页面相同OMS旧版本并发只有一方提交，失败方不写回执', async () => {
  const f = saveProtocolFixture(), expected = inboundSavedVersion(f.rows()[0])
  const outcomes = await Promise.allSettled([runInboundSave(f.db, saveId, 'u1', 'c1', [{ expected, order: { ...f.rows()[0], totalQty: 5 } }], f.save), runInboundSave(f.db, saveId2, 'u2', 'c1', [{ expected, order: { ...f.rows()[0], totalQty: 7 } }], f.save)])
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);assert.equal(f.count(), 1);assert.equal(f.receipts().length, 1)
  const rejected = outcomes.find(r => r.status === 'rejected') as PromiseRejectedResult
  assert.match(rejected.reason.message, /发生变化.*未覆盖/)
})
test('未知查询不写记录，取消回执阻止迟到原保存，但不撤销已确认的保存', async () => {
  const f = saveProtocolFixture(), plan = [{ expected: inboundSavedVersion(f.rows()[0]), order: { ...f.rows()[0], totalQty: 5 } }]
  assert.equal((await resolveInboundSave(f.db, saveId, 'u1', 'c1', plan, false)).status, 'unknown');assert.equal(f.receipts().length, 0)
  assert.equal((await resolveInboundSave(f.db, saveId, 'u1', 'c1', plan, true)).status, 'cancelled')
  assert.equal((await runInboundSave(f.db, saveId, 'u1', 'c1', plan, f.save)).status, 'cancelled');assert.equal(f.count(), 0)
  assert.equal(f.rows()[0].totalQty, 2)
})
test('原请求绑定账号客户和完整内容，无法更改载荷或跨账号读取', async () => {
  const f = saveProtocolFixture(), plan = [{ expected: inboundSavedVersion(f.rows()[0]), order: { ...f.rows()[0], totalQty: 5 } }]
  await runInboundSave(f.db, saveId, 'u1', 'c1', plan, f.save)
  await assert.rejects(runInboundSave(f.db, saveId, 'u1', 'c1', [{ ...plan[0], order: { ...plan[0].order, remark: 'changed' } }], f.save), /内容不能更改/)
  await assert.rejects(resolveInboundSave(f.db, saveId, 'u2', 'c1', plan, false), e => e instanceof InboundIdentityError && e.status === 403)
  await assert.rejects(resolveInboundSave(f.db, saveId, 'u1', 'c2', plan, false), /不属于当前客户/)
})
test('先校验整批版本，第二张单冲突不保存第一张；回执故障同样回滚整批', async () => {
  const f = saveProtocolFixture(), first = { expected: null, order: { ...data, id: 'new', inboundNo: 'NEW' } }
  await assert.rejects(runInboundSave(f.db, saveId, 'u1', 'c1', [first, { expected: null, order: { ...f.rows()[0], totalQty: 5 } }], f.save), /发生变化/)
  assert.equal(f.count(), 0);assert.equal(f.rows().length, 1)
  f.failReceipt();await assert.rejects(runInboundSave(f.db, saveId, 'u1', 'c1', [first], f.save), /receipt storage failure/)
  assert.equal(f.rows().length, 1);assert.equal(f.receipts().length, 0)
})
test('重复单号、损坏原版本和创建覆盖既存记录均拒绝且不保存', async () => {
  const f = saveProtocolFixture(), plan = { expected: null, order: { ...f.rows()[0] } }
  await assert.rejects(runInboundSave(f.db, saveId, 'u1', 'c1', [plan, plan], f.save), /重复/)
  await assert.rejects(runInboundSave(f.db, saveId, 'u1', 'c1', [{ ...plan, expected: 'bad' }], f.save), /版本无效/)
  await assert.rejects(runInboundSave(f.db, saveId, 'u1', 'c1', [plan], f.save), /发生变化/)
  assert.equal(f.count(), 0)
})
test('即使调用方声明ERP确认，当前已保存草稿也不能绕过独立OMS版本', async () => {
  const f = saveProtocolFixture();let canonicalChecks = 0
  await assert.rejects(runInboundSave(f.db, saveId, 'u1', 'c1', [{ expected: null, order: { ...f.rows()[0], omsAcknowledgementKind: 'withdraw', totalQty: 9 } }], f.save, async () => { canonicalChecks++;return true }), /发生变化/)
  assert.equal(canonicalChecks, 0);assert.equal(f.count(), 0);assert.equal(f.rows()[0].totalQty, 2)
})

function webhookFixture(status = 'pending_receipt', local = 'on_the_way') {
  const f = linkedSnapshot(status), events: string[] = []
  let row: any = { id: 'saved', ...data, status: local }, writes = 0, present = true
  const current: any = { ...f.trusted, inboundType: '自发头程', id: 12, omsCustomerCode: 'TKL9001', status, omsStatus: status === 'cancelled' ? 'voided' : 'on_the_way', totalExpectedQty: 2, totalReceivedQty: 0,
    warehouseCode: 'WMS-JHB-01', trackingNo: null, createdAt: '2026-11-02T00:00:00Z', remark: null, items: [{ sku: 'A', expectedQty: 2, receivedQty: 0, productName: '商品A' }] }
  const tx: any = { ...f.tx,
    customerAccount: { findFirst: async () => ({ id: 'c1' }) },
    $queryRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      const sql = parts.join('?'); events.push(sql)
      if (sql.includes('FROM customer WHERE')) return [{ id: 1n }]
      if (sql.includes('FROM oms_customeraccount')) return [{ id: 'c1', code: 'TKL9001' }]
      if (sql.includes('FROM inbound_order WHERE') && !present) return []
      return f.tx.$queryRaw(parts, ...values)
    },
    inboundOrder: { findUnique: async () => row, upsert: async ({ create, update }: any) => { row = row ? { ...row, ...update } : create; writes++;return row } },
  }
  const db: any = { $transaction: async (work: any) => { events.push('transaction');return work(tx) } }
  const fetch = async () => { events.push('fetch');return current }
  return { ...f, db, events, current, fetch, row: () => row, writes: () => writes, set: (value: any) => { row = value }, missing: () => { present = false } }
}
test('取消通知保留已保存的5件计划和附件原文，不按ERP旧2件重写', async () => {
  const f = webhookFixture('cancelled', 'draft'), plan = { ...f.row(), totalQty: 5, lineItems: JSON.stringify([{ sku: 'A', qty: 5, boxNo: 1 }]), remark: '新计划', attachments: '[]' }
  f.set(plan);const before = structuredClone(plan)
  const result = await receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, f.fetch)
  assert.match(result.skipped || '', /草稿已保留/);assert.equal(f.writes(), 0);assert.deepEqual(f.row(), before)
  assert.ok(f.events.indexOf('fetch') < f.events.indexOf('transaction'))
  const customer = f.events.findIndex(x => x.includes('FROM customer WHERE')), account = f.events.findIndex(x => x.includes('FROM oms_customeraccount')), order = f.events.findIndex(x => x.includes('FROM inbound_order WHERE'))
  assert.ok(customer < account && account < order)
})
test('通知仅触发读取，采用当前ERP明细和真实箱数，不沿用本地旧9箱或旧备注', async () => {
  const f = webhookFixture();f.set({ ...f.row(), totalQty: 99, boxCount: 9, remark: 'old' })
  const result = await receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, f.fetch)
  assert.equal(result.synced, true);assert.equal(f.row().totalQty, 2);assert.equal(f.row().boxCount, 1);assert.equal(f.row().remark, null);assert.equal(f.writes(), 1)
})
test('ERP在预读取和加锁之间改变时拒绝整次通知，不修改OMS', async () => {
  const f = webhookFixture(), before = structuredClone(f.row());f.header.updatedAt = new Date('2026-11-03')
  await assert.rejects(receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, f.fetch), /同步期间发生变化/)
  assert.equal(f.writes(), 0);assert.deepEqual(f.row(), before)
})
test('旧删除通知不能删除仍存在的ERP单或OMS历史，均不调用保存', async () => {
  const f = webhookFixture(), before = structuredClone(f.row())
  assert.match((await receiveInboundStatus(f.db, 'TKL9001', 'IB001', true, async () => { throw Error('must not fetch') })).skipped || '', /原单仍存在/)
  f.missing();assert.match((await receiveInboundStatus(f.db, 'TKL9001', 'IB001', true, f.fetch)).skipped || '', /保留 OMS 历史/)
  assert.deepEqual(f.row(), before);assert.equal(f.writes(), 0)
})
test('通知不能跨客户覆盖，货盘也不能混入客户入库作业', async () => {
  const f = webhookFixture();f.current.omsCustomerCode = 'OTHER'
  await assert.rejects(receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, f.fetch), e => e instanceof InboundIdentityError && e.status === 403)
  f.current.omsCustomerCode = 'TKL9001';f.set({ ...f.row(), customerId: 'other' })
  await assert.rejects(receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, f.fetch), /其他客户/)
  f.set(null);f.current.stockSource = 'catalog';assert.match((await receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, f.fetch)).skipped || '', /货盘/);assert.equal(f.writes(), 0)
})
test('历史ERP入库类型采用统一客户类型，预读取失败不会开始事务或覆盖记录', async () => {
  const f = webhookFixture();f.current.inboundType = '客户自发';f.current.deliveryMethod = null
  assert.equal((await receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, f.fetch)).synced, true)
  assert.equal(f.row().inboundType, '自发头程');assert.equal(f.row().deliveryMethod, 'self')
  const before = structuredClone(f.row()), writes = f.writes()
  await assert.rejects(receiveInboundStatus(f.db, 'TKL9001', 'IB001', false, async () => { throw Error('ERP read failed') }), /ERP read failed/)
  assert.equal(f.writes(), writes);assert.deepEqual(f.row(), before)
})
