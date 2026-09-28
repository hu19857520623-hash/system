import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTakealotParsed, parseTakealotDocumentText } from './takealotDocParser.ts'

test('booking confirmation uses delivered units rather than collected units', () => {
  const parsed = parseTakealotDocumentText(`
Booking Confirmation
Date of Booking: Sep 29, 2026
Booking Reference Number: TALBMWDXU5395063
Delivery Details:
TAL MP 188734430 ASNJHBMP188734430 1 Customer
Total units on delivery: 1
Total units to collect: 0
`, '预约单')

  assert.equal(parsed.poNumber, '188734430')
  assert.equal(parsed.totalUnits, 1)
})

test('unit-label barcode does not overwrite the shipping note seller SKU', () => {
  const merged = mergeTakealotParsed(
    { sources: ['shipping note'], lineItems: [{ sku: 'HX0001', barcode: '9902380084674', qty: 1, expectedQty: 1 }] },
    { sources: ['unit label'], lineItems: [{ sku: '9902380084674', barcode: '9902380084674', qty: 1, observedLabelCount: 1 }] },
  )

  assert.equal(merged.lineItems[0].sku, 'HX0001')
  assert.equal(merged.lineItems[0].observedLabelCount, 1)
})
