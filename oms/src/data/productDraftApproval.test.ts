import test from 'node:test'
import assert from 'node:assert/strict'
import type { Product } from './mockData'
import { approveProductDrafts } from './productDraftApproval.ts'

const product = { id: 'p1', customerId: 'c1', customerSku: 'A', internalSku: 'TKL005-A', name: '产品 A',
  productStatus: 'draft', inCatalog: false, lengthCm: 10, widthCm: 20, heightCm: 30,
  weightKg: 1, declaredValue: 20, image: '', hasBattery: false } as Product

test('review marks a valid OMS draft available without creating ERP master data', async () => {
  const calls: string[] = []
  const result = await approveProductDrafts([product], {
    customerCodeFor: () => 'TKL005',
    markAvailable: async ids => { calls.push('oms-available'); assert.deepEqual(ids, ['p1']) },
  })
  assert.deepEqual(calls, ['oms-available'])
  assert.deepEqual(result.approvedIds, ['p1'])
  assert.deepEqual(result.failures, [])
})

test('invalid drafts stay unchanged while valid drafts are approved', async () => {
  let marked: string[] = []
  const result = await approveProductDrafts([product, { ...product, id: 'p2', lengthCm: 0 }], {
    customerCodeFor: () => 'TKL005',
    markAvailable: async ids => { marked = ids },
  })
  assert.deepEqual(marked, ['p1'])
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0].error, /有效的长宽高/)
  assert.equal(product.productStatus, 'draft')
})

test('available, discarded and catalog products are not reviewed again', async () => {
  let calls = 0
  const result = await approveProductDrafts([{ ...product, productStatus: 'available' },
    { ...product, productStatus: 'discarded' }, { ...product, inCatalog: true }], {
    customerCodeFor: () => 'TKL005', markAvailable: async () => { calls++ },
  })
  assert.equal(calls, 0)
  assert.deepEqual(result.approvedIds, [])
})

test('OMS save failure can be retried without changing the draft locally', async () => {
  let attempts = 0
  const dependencies = {
    customerCodeFor: () => 'TKL005',
    markAvailable: async () => { if (++attempts === 1) throw new Error('OMS save failed') },
  }
  await assert.rejects(approveProductDrafts([product], dependencies), /OMS save failed/)
  const result = await approveProductDrafts([product], dependencies)
  assert.equal(attempts, 2)
  assert.deepEqual(result.approvedIds, ['p1'])
})
