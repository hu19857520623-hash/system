import test from 'node:test'
import assert from 'node:assert/strict'
import { displaySku, displaySkuText } from './skuDisplay.ts'

test('display hides a legacy customer prefix without changing the stored value', () => {
  const sku = 'TKL005-710667-2'
  assert.equal(displaySku(sku), '710667-2')
  assert.equal(sku, 'TKL005-710667-2')
  assert.equal(displaySku('CUSTOM-710667'), 'CUSTOM-710667')
  assert.equal(displaySku('9902301890599'), '9902301890599')
})

test('UI summaries preserve document numbers and show all customer SKU values', () => {
  assert.equal(displaySkuText('RVTKL005-261009-0011：TKL005-A、TKL0444-B'), 'RVTKL005-261009-0011：A、B')
})
