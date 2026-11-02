import test from 'node:test'
import assert from 'node:assert/strict'
import { inboundPendingKey, readInboundPending, saveInboundPending, clearInboundPending, type InboundPending } from './inboundPending'

function fixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const record: InboundPending = { version: 1, kind: 'update', customerCode: 'TKL9069', inboundNo: 'TEST-86', body: { clientRequestId: '11111111-1111-4111-8111-111111111111', expectedVersion: 'a'.repeat(64), inboundNo: 'TEST-86', customerCode: 'TKL9069', customerId: 'c1', items: [{ sku: 'A', qty: 1 }] }, localOrder: { id: 'local-one', customerId: 'c1', inboundNo: 'TEST-86' } as any, createdAt: '2026-11-02' }
  return { values, storage, record, key: inboundPendingKey('user-one', record.customerCode, record.inboundNo) }
}

test('保存原请求后即使表单被修改，重开页面仍读取原始请求', () => {
  const f = fixture(); saveInboundPending(f.storage, f.key, f.record)
  ;(f.record.body.items as any[])[0].qty = 9
  assert.equal((readInboundPending(f.storage, f.key)!.body.items as any[])[0].qty, 1)
  assert.throws(() => saveInboundPending(f.storage, f.key, f.record), /先读取或重试原请求/)
  assert.notEqual(f.key, inboundPendingKey('user-two', 'TKL9069', 'TEST-86'))
})

test('存储配额、写后读取不一致和损坏记录均阻止首次发送', () => {
  const f = fixture()
  assert.throws(() => saveInboundPending({ ...f.storage, setItem: () => { throw Error('quota') } }, f.key, f.record), /本次没有发送/)
  assert.throws(() => saveInboundPending({ ...f.storage, setItem: () => {} }, f.key, f.record), /本次没有发送/)
  f.values.set(f.key, 'corrupted')
  assert.throws(() => readInboundPending(f.storage, f.key), /暂不提交新操作/)
})

test('迟到响应不能清除另一个页面的新请求；仅原记录可清除', () => {
  const f = fixture(); const original = saveInboundPending(f.storage, f.key, f.record)
  f.values.set(f.key, JSON.stringify({ ...original, createdAt: '2026-11-03' }))
  assert.throws(() => clearInboundPending(f.storage, f.key, original), /其他页面更新/)
  f.values.set(f.key, JSON.stringify(original)); clearInboundPending(f.storage, f.key, original)
  assert.equal(readInboundPending(f.storage, f.key), null)
})

test('字段不完整或客户单号不一致的原记录保持原字节并禁止读取重试', () => {
  const f = fixture()
  const changes = [
    { body: { ...f.record.body, inboundNo: 'OTHER' } },
    { body: { ...f.record.body, customerCode: 'OTHER' } },
    { body: { ...f.record.body, customerId: 'OTHER' } },
    { body: { ...f.record.body, clientRequestId: undefined } },
    { body: { ...f.record.body, expectedVersion: undefined } },
    { body: { ...f.record.body, clientRequestId: 'not-a-request-id' } },
    { body: { ...f.record.body, items: [{ sku: 'A', qty: -1 }] } },
    { body: [] }, { body: null },
    { localOrder: { ...f.record.localOrder, inboundNo: 'OTHER' } },
    { localOrder: { inboundNo: f.record.inboundNo } },
    { kind: 'void' }, { createdAt: 'invalid-time' },
  ]
  for (const patch of changes) {
    const raw = JSON.stringify({ ...f.record, ...patch }); f.values.set(f.key, raw)
    assert.throws(() => readInboundPending(f.storage, f.key), /原入库操作记录无法读取/)
    assert.equal(f.values.get(f.key), raw)
  }
})

test('创建和取消的合法原请求可以重开；不完整的新请求不得落盘', () => {
  const f = fixture()
  for (const kind of ['create', 'withdraw', 'void'] as const) {
    const body = kind === 'create' ? { ...f.record.body, expectedVersion: undefined } : { customerId: 'c1', customerCode: 'TKL9069', clientRequestId: f.record.body.clientRequestId, expectedVersion: f.record.body.expectedVersion }
    const record = { ...f.record, kind, body }
    assert.equal(saveInboundPending(f.storage, f.key, record).kind, kind)
    clearInboundPending(f.storage, f.key, readInboundPending(f.storage, f.key)!)
  }
  assert.throws(() => saveInboundPending(f.storage, f.key, { ...f.record, body: { ...f.record.body, inboundNo: 'OTHER' } }), /本次没有发送/)
  assert.equal(f.values.get(f.key), undefined)
})
