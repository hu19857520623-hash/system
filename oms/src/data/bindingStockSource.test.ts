import test from 'node:test'
import assert from 'node:assert/strict'
import { bindingStockSource } from './bindingStockSource.ts'
import { resolvePlatformBarcode } from './platformBindingUtils.ts'
import { hydrateInventory } from './inventoryStore.ts'
import { setPlatformSkuMappings } from './entityStore.ts'
import { applyTakealotShippingNoteBindings } from './takealotAutoBind.ts'
import type { Product, PlatformSkuMapping } from './mockData.ts'

test('catalog products override an old owned flag and manual choices follow the selected SKU', () => {
  const products = [{ internalSku: 'SHARED', inCatalog: true, customerId: 'tkl' }, { internalSku: 'OWNED', inCatalog: false, customerId: 'a' }]
  assert.equal(bindingStockSource([{ internalSku: 'SHARED' }], products, 'owned'), 'catalog')
  assert.equal(bindingStockSource([{ internalSku: 'OWNED' }], products, 'catalog'), 'owned')
})

test('two customers independently resolve the same 990 and catalog SKU, only within OMS', () => {
  const product = { id: 'pool', internalSku: 'SHARED', customerSku: 'SHARED', name: 'Shared product', inCatalog: true, customerId: 'tkl' } as Product
  hydrateInventory({ products: [product], inventory: [], purchases: [] })
  let mappings: PlatformSkuMapping[] = []
  for (const customerId of ['a', 'b']) {
    mappings = applyTakealotShippingNoteBindings({
      items: [{ barcode: '9902380084674', sku: 'SHARED' }], mappings, products: [product],
      customerId, sellerId: customerId + '-seller', stockSource: 'owned', now: '2026-10-13',
    }).mappings
  }
  assert.equal(mappings.length, 2)
  assert.ok(mappings.every(mapping => mapping.stockSource === 'catalog'))
  setPlatformSkuMappings(mappings)
  for (const customerId of ['a', 'b']) {
    const result = resolvePlatformBarcode('9902380084674', { customerId, sellerId: 'uploaded-seller' })
    assert.equal(result.status, 'resolved')
    if (result.status === 'resolved') assert.equal(result.mapping.customerId, customerId)
  }
  assert.equal(resolvePlatformBarcode('9902380084674', { customerId: 'c' }).status, 'unmatched')
})
