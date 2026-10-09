import test from 'node:test'
import assert from 'node:assert/strict'
import type { Product } from './mockData'
import { approveProductDrafts } from './productDraftApproval.ts'

const product = { id: 'p1', customerId: 'c1', customerSku: 'A', internalSku: 'TKL005-A', name: '产品 A',
  productStatus: 'draft', inCatalog: false, lengthCm: 10, widthCm: 20, heightCm: 30,
  weightKg: 1, declaredValue: 20, image: '', hasBattery: false } as Product
const response = { id: 1, sku: 'TKL005-A', productName: '产品 A', status: 'active' }
const missing = () => Object.assign(new Error('not found'), { status: 404 })

test('review synchronizes imported draft data before marking it available', async () => {
  const calls: string[] = []
  const result = await approveProductDrafts([product], {
    customerCodeFor: () => 'TKL005',
    update: async () => { calls.push('update'); throw missing() },
    create: async body => { calls.push('create'); assert.equal(body.customerSku, 'A'); assert.equal(body.heightCm, 30); return response },
    markAvailable: async ids => { calls.push('available'); assert.deepEqual(ids, ['p1']) },
  })
  assert.deepEqual(calls, ['update', 'create', 'available'])
  assert.deepEqual(result.approvedIds, ['p1'])
  assert.deepEqual(result.failures, [])
})

test('partially failed batch approves only successfully synchronized products', async () => {
  let marked: string[] = []
  const result = await approveProductDrafts([product, { ...product, id: 'p2', internalSku: 'TKL005-B', customerSku: 'B' }], {
    customerCodeFor: () => 'TKL005', update: async () => { throw missing() },
    create: async body => { if (body.customerSku === 'B') throw new Error('ERP unavailable'); return response },
    markAvailable: async ids => { marked = ids },
  })
  assert.deepEqual(marked, ['p1'])
  assert.deepEqual(result.failures, [{ sku: 'B', error: 'ERP unavailable' }])
  assert.equal(product.productStatus, 'draft')
})

test('invalid dimensions remain draft and do not submit to ERP', async () => {
  let calls = 0
  const result = await approveProductDrafts([{ ...product, lengthCm: 0 }], {
    customerCodeFor: () => 'TKL005', update: async () => { calls++; return response },
    create: async () => { calls++; return response }, markAvailable: async () => { calls++ },
  })
  assert.equal(calls, 0)
  assert.equal(result.approvedIds.length, 0)
  assert.match(result.failures[0].error, /有效的长宽高/)
})

test('available and discarded products and catalog cards are not re-reviewed', async () => {
  let calls = 0
  const result = await approveProductDrafts([{ ...product, productStatus: 'available' },
    { ...product, productStatus: 'discarded' }, { ...product, inCatalog: true }], {
    customerCodeFor: () => 'TKL005', update: async () => { calls++; return response },
    markAvailable: async () => { calls++ },
  })
  assert.equal(calls, 0)
  assert.deepEqual(result.approvedIds, [])
})

test('retry after an OMS save failure updates the existing ERP SKU without creating a duplicate', async () => {
  let erpSaved = false
  let created = 0
  let persistAttempts = 0
  const dependencies = {
    customerCodeFor: () => 'TKL005',
    update: async () => { if (!erpSaved) throw missing(); return response },
    create: async () => { erpSaved = true; created++; return response },
    markAvailable: async () => { if (++persistAttempts === 1) throw new Error('OMS save failed') },
  }
  await assert.rejects(approveProductDrafts([product], dependencies), /OMS save failed/)
  const result = await approveProductDrafts([product], dependencies)
  assert.equal(created, 1)
  assert.deepEqual(result.approvedIds, ['p1'])
})
