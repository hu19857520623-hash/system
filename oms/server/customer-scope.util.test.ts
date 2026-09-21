import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isCatalogPoolRecord,
  isCatalogPoolScope,
  selectCustomerInventoryState,
} from './customer-scope.util.js'

test('recognizes the shared catalog pool customer', () => {
  assert.equal(isCatalogPoolScope('tkl'), true)
  assert.equal(isCatalogPoolScope('TKL'), true)
  assert.equal(isCatalogPoolScope('customer-1'), false)
  assert.equal(isCatalogPoolRecord({ customerId: 'tkl', inCatalog: true }), true)
  assert.equal(isCatalogPoolRecord({ customerId: '', stockSource: 'catalog' }), true)
  assert.equal(isCatalogPoolRecord({ customerId: 'customer-1', stockSource: 'catalog' }), false)
})

test('drops catalog pool rows and keeps the authenticated customer inventory state', () => {
  const result = selectCustomerInventoryState({
    products: [
      { id: 'p-own', customerId: 'customer-1', internalSku: 'C1-A' },
      { id: 'p-pool', customerId: 'tkl', inCatalog: true, internalSku: 'HX6' },
    ],
    inventory: [
      { id: 'i-own', customerId: 'customer-1', sku: 'C1-A', stockSource: 'owned' },
      { id: 'i-hold', customerId: 'customer-1', sku: 'HX6', stockSource: 'catalog' },
      { id: 'i-pool', customerId: 'tkl', sku: 'HX6', stockSource: 'catalog' },
    ],
    purchases: [
      { id: 'buy-1', customerId: 'customer-1', sku: 'HX6' },
    ],
  }, 'customer-1')

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.products.map(item => item.id), ['p-own'])
  assert.deepEqual(result.inventory.map(item => item.id), ['i-own', 'i-hold'])
  assert.deepEqual(result.purchases.map(item => item.id), ['buy-1'])
})

test('rejects another customer mixed into inventory-state', () => {
  const result = selectCustomerInventoryState({
    products: [{ id: 'p-other', customerId: 'customer-2', internalSku: 'C2-A' }],
    inventory: [],
    purchases: [],
  }, 'customer-1')
  assert.deepEqual(result, { ok: false, error: 'Cross-customer mutation denied' })
})
