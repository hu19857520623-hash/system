import test from 'node:test'
import assert from 'node:assert/strict'
import { hydrateInventory, getProductsSnapshot, getInventorySnapshot, mergeErpCatalogIntoState } from './inventoryStore.ts'
import { CATALOG_CUSTOMER_ID } from './skuCode.ts'
import type { ErpCatalogItem } from '../api/erp.ts'

const item: ErpCatalogItem = {
  sku: 'FUR-KIT-SID-004', customerCode: 'TKL', customerSku: 'FUR-KIT-SID-004', dimensionsSource: 'master', productName: 'Kitchen Sideboard', imageUrl: '', spec: '', price: 100,
  lengthCm: 10, widthCm: 20, heightCm: 30, weightKg: 2, catalogStockPool: 20, soldQty: 5,
  remainingStockQty: 15, visibleOnOms: true, orderableOnOms: true, shareStatus: 'enabled', syncedAt: '2026-10-13',
}

test('ERP catalog refresh never saves an inventory snapshot or attempts to recreate its SKU', async () => {
  hydrateInventory({ products: [], inventory: [], purchases: [] })
  const originalFetch = globalThis.fetch
  const calls: unknown[] = []
  globalThis.fetch = async (...args) => { calls.push(args); throw new Error('Unexpected write') }
  try {
    await mergeErpCatalogIntoState([item])
    await mergeErpCatalogIntoState([{ ...item, remainingStockQty: 12, price: 110 }])
    assert.deepEqual(calls, [])
    assert.equal(getProductsSnapshot().length, 1)
    assert.equal(getProductsSnapshot()[0].internalSku, item.sku)
    assert.equal(getProductsSnapshot()[0].price, 110)
    assert.equal(getInventorySnapshot()[0].available, 12)
  } finally { globalThis.fetch = originalFetch }
})

test('catalog refresh preserves a customer holding with the same ERP SKU', async () => {
  hydrateInventory({ products: [], inventory: [], purchases: [] })
  await mergeErpCatalogIntoState([item])
  const holding = { ...getProductsSnapshot()[0], id: 'holding', customerId: 'cust-a', availableQty: 3, catalogVisibleOnOms: false }
  const inventory = { ...getInventorySnapshot()[0], id: 'holding-stock', customerId: 'cust-a', available: 3 }
  hydrateInventory({ products: [holding], inventory: [inventory], purchases: [] })
  await mergeErpCatalogIntoState([{ ...item, remainingStockQty: 8 }])
  assert.equal(getProductsSnapshot().find(p => p.id === 'holding')?.customerId, 'cust-a')
  assert.equal(getProductsSnapshot().find(p => p.id === 'holding')?.availableQty, 3)
  assert.equal(getInventorySnapshot().find(i => i.id === 'holding-stock')?.available, 3)
  assert.equal(getProductsSnapshot().filter(p => p.customerId === CATALOG_CUSTOMER_ID).length, 1)
  await mergeErpCatalogIntoState([])
  assert.equal(getProductsSnapshot().length, 1)
  assert.equal(getProductsSnapshot()[0].id, 'holding')
})
