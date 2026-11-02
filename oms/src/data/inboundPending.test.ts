import test from 'node:test'
import assert from 'node:assert/strict'
import { inboundPendingKey, readInboundPending, saveInboundPending, clearInboundPending, type InboundPending } from './inboundPending'

function fixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const record: InboundPending = { version: 1, kind: 'update', customerCode: 'TKL9069', inboundNo: 'TEST-86', body: { clientRequestId: 'original', items: [{ sku: 'A', qty: 1 }] }, localOrder: { inboundNo: 'TEST-86' } as any, createdAt: '2026-11-02' }
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
  f.values.set(f.key, JSON.stringify({ ...original, kind: 'void' }))
  assert.throws(() => clearInboundPending(f.storage, f.key, original), /其他页面更新/)
  f.values.set(f.key, JSON.stringify(original)); clearInboundPending(f.storage, f.key, original)
  assert.equal(readInboundPending(f.storage, f.key), null)
})
