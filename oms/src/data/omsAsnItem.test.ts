import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOmsAsnItem } from './omsAsnItem.ts'

test('copies customer product dimensions onto an OMS ASN item', () => {
  assert.deepEqual(
    buildOmsAsnItem(
      { sku: 'CUS-CHAIR-01', qty: 8, name: 'Chair', boxNo: 2 },
      { lengthCm: 61.5, widthCm: 42, heightCm: 18.25 },
    ),
    {
      sku: 'CUS-CHAIR-01',
      qty: 8,
      productName: 'Chair',
      boxNo: 2,
      lengthCm: 61.5,
      widthCm: 42,
      heightCm: 18.25,
    },
  )
})

test('does not send zero or invalid dimensions', () => {
  assert.deepEqual(
    buildOmsAsnItem(
      { sku: 'CUS-CHAIR-01', qty: 1, name: 'Chair', boxNo: 1 },
      { lengthCm: 0, widthCm: Number.NaN, heightCm: null },
    ),
    {
      sku: 'CUS-CHAIR-01',
      qty: 1,
      productName: 'Chair',
      boxNo: 1,
      lengthCm: undefined,
      widthCm: undefined,
      heightCm: undefined,
    },
  )
})
