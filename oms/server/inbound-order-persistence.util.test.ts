import test from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { InboundIdentityError, saveInboundOrder } from './inbound-order-persistence.util.js'

const data = { customerId: 'c1', inboundNo: 'IB001', source: 'ERP回传', inboundType: '客户自发', deliveryMethod: 'self',
  stockSource: 'owned', boxCount: 1, skuCount: 1, totalQty: 2, receivedQty: 1, status: 'partial', createdAt: '2026-10-09', warehouse: 'jhb1' }
function repository(initial: { id: string; inboundNo: string; customerId: string | null }[]) {
  const rows = initial.map(row => ({ ...row }))
  const tx = { inboundOrder: {
    findUnique: async ({ where }: { where: { id?: string; inboundNo?: string } }) =>
      rows.find(r => where.id ? r.id === where.id : r.inboundNo === where.inboundNo) ?? null,
    upsert: async ({ where, create, update }: { where: { inboundNo: string }; create: typeof data & { id: string }; update: typeof data }) => {
      const row = rows.find(r => r.inboundNo === where.inboundNo)
      if (row) { Object.assign(row, update); return { id: row.id, inboundNo: row.inboundNo } }
      rows.push({ ...create }); return { id: create.id, inboundNo: create.inboundNo }
    },
  } } as unknown as Pick<Prisma.TransactionClient, 'inboundOrder'>
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
