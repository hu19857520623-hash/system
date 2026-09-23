import test from 'node:test'
import assert from 'node:assert/strict'
import {
  holdingEanFromCatalogPool,
  mappingBelongsToCustomer,
  pickPrimaryPlatformBarcode,
} from './platformBarcodeScope.ts'

function mapping(input: {
  customerId?: string
  barcode: string
  sku: string
  status?: 'active' | 'unmapped'
}) {
  return {
    status: input.status ?? 'active',
    platformBarcode: input.barcode,
    customerId: input.customerId,
    lines: [{ internalSku: input.sku, warehouseName: input.sku, packType: '自带包装', qty: 1 }],
  }
}

test('catalog pool 990 is not copied onto customer holdings', () => {
  assert.equal(holdingEanFromCatalogPool('9902368930351'), undefined)
  assert.equal(holdingEanFromCatalogPool('6001234567890'), '6001234567890')
  assert.equal(holdingEanFromCatalogPool(''), undefined)
})

test('mappings do not leak across customers', () => {
  assert.equal(mappingBelongsToCustomer({ customerId: 'cust-a' }, 'cust-a'), true)
  assert.equal(mappingBelongsToCustomer({ customerId: 'cust-a' }, 'cust-b'), false)
  assert.equal(mappingBelongsToCustomer({ customerId: undefined }, 'cust-a'), false)
  assert.equal(mappingBelongsToCustomer({ customerId: 'cust-a' }, undefined), true)
})

test('same catalog SKU keeps a distinct 990 per customer', () => {
  const mappings = [
    mapping({ customerId: 'cust-a', barcode: '9901111111111', sku: 'HX6' }),
    mapping({ customerId: 'cust-b', barcode: '9902222222222', sku: 'HX6' }),
  ]
  assert.equal(pickPrimaryPlatformBarcode(mappings, 'HX6', 'cust-a'), '9901111111111')
  assert.equal(pickPrimaryPlatformBarcode(mappings, 'HX6', 'cust-b'), '9902222222222')
  assert.equal(pickPrimaryPlatformBarcode(mappings, 'HX6'), undefined)
})
