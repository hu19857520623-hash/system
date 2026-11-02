import test from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { InboundIdentityError, saveInboundOrder, deleteInboundDraft } from './inbound-order-persistence.util.js'

const data = { customerId: 'c1', inboundNo: 'IB001', source: 'ERP回传', inboundType: '客户自发', deliveryMethod: 'self',
  stockSource: 'owned', boxCount: 1, skuCount: 1, totalQty: 2, receivedQty: 1, status: 'partial', createdAt: '2026-10-09', warehouse: 'jhb1' }
function repository(initial: { id: string; inboundNo: string; customerId: string | null }[]) {
  const rows = initial.map(row => ({ ...row }))
  const tx = { $queryRaw: async (query: TemplateStringsArray) => query.join('?').includes('snapshot_tombstone') ? [] : [{ code: 'TKL9001', id: 1n }], $executeRaw: async () => 1, inboundOrder: {
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
  assert.equal((rows[0] as typeof data & { id: string }).receivedQty, 1)
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
