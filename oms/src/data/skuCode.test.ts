import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCustomerSku } from './skuCode.ts'

test('accepts an OMS customer SKU of at most 11 characters', () => {
  assert.equal(validateCustomerSku('ABCDEFGHIJK'), null)
})

test('rejects blank and 12-character OMS customer SKUs', () => {
  assert.equal(validateCustomerSku('   '), '请填写 SKU')
  assert.equal(validateCustomerSku('ABCDEFGHIJKL'), '客户 SKU 须少于 12 位')
})
