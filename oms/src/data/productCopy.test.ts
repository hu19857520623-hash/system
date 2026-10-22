import assert from 'node:assert/strict'
import test from 'node:test'
import type { Product } from './mockData'
import { productCopyTemplate } from './productCopy'

const source = {
  id: 'source', customerId: 'customer-one', internalSku: 'TKL9001-ORIGINAL', customerSku: 'ORIGINAL',
  name: '产品一', spec: '规格一', image: 'test.png', price: 30, cost: 20,
  availableQty: 191, lockedQty: 9, customCode: 'custom', category: '家具', categoryPath: '家具/桌子',
  weight: '1 kg', weightKg: 1, lengthCm: 10, widthCm: 20, heightCm: 30,
  inCatalog: true, catalogStockPool: 200, catalogSoldQty: 10, catalogVisibleOnOms: true,
  catalogOrderableOnOms: true, catalogShareStatus: 'enabled', catalogSyncedAt: '2026-10-16',
  productStatus: 'available', discardedFrom: 'available', productSource: 'import',
  hasBattery: false, certUploaded: true, hasBoxSpec: true, outerBoxBarcode: 'BOX-ORIGINAL',
  declaredNameEn: 'Table', declaredNameCn: '桌子', declaredValue: 20, unit: 'PCS',
} satisfies Product

test('复制已提交商品成为可填写新 SKU 的草稿，不复制原商品身份或库存', () => {
  const copy = productCopyTemplate(source)
  assert.equal(copy.id, '')
  assert.equal(copy.internalSku, '')
  assert.equal(copy.customerSku, '')
  assert.equal(copy.productStatus, 'draft')
  assert.equal(copy.availableQty, 0)
  assert.equal(copy.lockedQty, 0)
  assert.equal(copy.productSource, 'manual')
  assert.equal(copy.customerId, source.customerId)
  assert.equal(copy.name, source.name)
  assert.equal(copy.lengthCm, source.lengthCm)
  assert.equal(copy.declaredNameEn, source.declaredNameEn)
  assert.equal(copy.image, source.image)
})

test('复制不携带货盘发布、外箱身份、证书及回收站状态，也不修改原商品', () => {
  const original = structuredClone(source)
  const copy = productCopyTemplate(source)
  assert.equal(copy.inCatalog, false)
  assert.equal(copy.certUploaded, false)
  assert.equal(copy.price, 0)
  for (const field of ['outerBoxBarcode', 'discardedFrom', 'catalogStockPool', 'catalogSoldQty',
    'catalogVisibleOnOms', 'catalogOrderableOnOms', 'catalogShareStatus', 'catalogSyncedAt']) {
    assert.equal(field in copy, false, field)
  }
  copy.name = '新商品'
  assert.deepEqual(source, original)
})
