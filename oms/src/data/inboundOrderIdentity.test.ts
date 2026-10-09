import test from 'node:test'
import assert from 'node:assert/strict'
import type { InboundOrder } from './mockData'
import { mergeInboundOrder, reconcileInboundIds } from './inboundOrderIdentity.ts'
import { cacheInboundOrder, getInboundOrdersSnapshot, setInboundOrders } from './entityStore.ts'

const order = { id: 'oms-original', customerId: 'c1', inboundNo: 'IB001', totalQty: 2, receivedQty: 0 } as InboundOrder

test('polling keeps canonical identity and updates the view without requesting a save', async () => {
  setInboundOrders([order])
  const previousFetch = globalThis.fetch
  const storageDescriptors = ['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const [key] of storageDescriptors) Object.defineProperty(globalThis, key, {
    configurable: true, value: { getItem: () => null, removeItem: () => {} },
  })
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('Polling must not save inbound orders') }
  try {
    cacheInboundOrder({ ...order, id: 'erp-ib-12', receivedQty: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(calls, 0)
    assert.equal(getInboundOrdersSnapshot().length, 1)
    assert.equal(getInboundOrdersSnapshot()[0].id, 'oms-original')
    assert.equal(getInboundOrdersSnapshot()[0].receivedQty, 1)
  } finally {
    globalThis.fetch = previousFetch
    for (const [key, descriptor] of storageDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

test('save-response identity reconciliation retains newer local data and other orders', () => {
  const base = mergeInboundOrder({ ...order, id: 'erp-ib-12', receivedQty: 2 }, [order, { ...order, id: 'other', inboundNo: 'IB002' }])
  const reconciled = reconcileInboundIds(base, [{ id: 'database-id', inboundNo: 'IB001' }])
  assert.equal(reconciled[0].id, 'database-id')
  assert.equal(reconciled[0].receivedQty, 2)
  assert.equal(reconciled[1].id, 'other')
})
