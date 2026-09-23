import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTakealotShippingNoteBindings } from './takealotAutoBind.ts'
import type { PlatformSkuMapping } from './mockData.ts'

const catalogProduct = {
  internalSku: 'HX6',
  customerSku: 'HX6',
  name: '6双袜',
}

function catalogMapping(customerId: string, barcode: string): PlatformSkuMapping {
  return {
    id: `pb-note-${customerId}-${barcode}`,
    customerId,
    platform: 'Takealot',
    storeId: 's1',
    storeName: 'Takealot',
    platformBarcode: barcode,
    platformTitle: 'Socks',
    lines: [{ internalSku: 'HX6', warehouseName: '6双袜', packType: '自带包装', qty: 1 }],
    status: 'active',
    stockSource: 'catalog',
    syncSource: 'import',
    version: 1,
    hasInventory: false,
    updatedAt: '2026-09-23',
  }
}

test('auto-bind lets a second customer attach a different 990 to the same catalog SKU', () => {
  const existing = [catalogMapping('cust-a', '9901111111111')]
  const result = applyTakealotShippingNoteBindings({
    items: [{ barcode: '9902222222222', sku: 'HX6', productTitle: 'Socks' }],
    mappings: existing,
    products: [{ ...catalogProduct, customerId: 'tkl' }],
    customerId: 'cust-b',
    stockSource: 'catalog',
    now: '2026-09-23',
  })
  assert.equal(result.bound.length, 1)
  assert.equal(result.bound[0]?.barcode, '9902222222222')
  assert.equal(result.mappings.length, 2)
  assert.deepEqual(
    result.mappings.map(row => [row.customerId, row.platformBarcode]),
    [
      ['cust-a', '9901111111111'],
      ['cust-b', '9902222222222'],
    ],
  )
})

test('unscoped catalog mapping does not block a customer 990 bind', () => {
  const unscoped = catalogMapping('tkl', '9900000000000')
  unscoped.customerId = undefined
  const result = applyTakealotShippingNoteBindings({
    items: [{ barcode: '9903333333333', sku: 'HX6', productTitle: 'Socks' }],
    mappings: [unscoped],
    products: [{ ...catalogProduct, customerId: 'tkl' }],
    customerId: 'cust-c',
    stockSource: 'catalog',
    now: '2026-09-23',
  })
  assert.equal(result.bound.length, 1)
  assert.equal(result.bound[0]?.internalSku, 'HX6')
  assert.equal(result.mappings.some(row => row.customerId === 'cust-c' && row.platformBarcode === '9903333333333'), true)
})
