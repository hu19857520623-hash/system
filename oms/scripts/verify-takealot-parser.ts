import assert from 'node:assert/strict'
import {
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  takealotMissingFields,
  takealotParseConflicts,
  takealotParseWarnings,
} from '../src/data/takealotDocParser'

const manifestText = `
PO Number: 123456789
Shipment Name: PO-123456789-12/08/2026-JHB3-1
Due Date: 2026/08/14
Seller ID: 29896140
Created by Audit Store for Takealot
SKU: AUDIT-SKU-A Qty: 2
Seller SKU: AUDIT-SKU-B Quantity: 3
`

const bookingText = `
Booking Confirmation
Audit Store
Delivery Address: Johannesburg DC 3
Date of Booking: Aug 15, 2026
Time Slot: 10:30
Booking Reference Number: TALABC123
Seller ID: 29896140
Included POs: 123456789
`

assert.equal(detectTakealotDocKind('shipment-manifest.pdf', manifestText), '发货清单')
assert.equal(detectTakealotDocKind('TALABC123.pdf', bookingText), '预约单')

const manifest = parseTakealotDocumentText(manifestText, '发货清单')
const booking = parseTakealotDocumentText(bookingText, '预约单')
const merged = mergeTakealotParsed(manifest, booking)

assert.equal(merged.poNumber, '123456789')
assert.equal(merged.warehouseCode, 'jhb3')
assert.equal(merged.appointmentDate, '2026-08-15T10:30')
assert.equal(merged.bookingRef, 'TALABC123')
assert.equal(merged.sellerId, '29896140')
assert.equal(merged.sellerName, 'Audit Store')
assert.deepEqual(
  merged.lineItems.map(item => [item.sku, item.qty]),
  [['AUDIT-SKU-A', 2], ['AUDIT-SKU-B', 3]],
)
assert.deepEqual(takealotMissingFields(merged), [])
assert.deepEqual(takealotParseConflicts([manifest, booking]), [])

const conflict = parseTakealotDocumentText(
  'PO Number: 999999999\nSeller SKU: AUDIT-SKU-A Quantity: 5',
  '发货清单',
)
assert.ok(takealotParseConflicts([manifest, conflict]).length >= 2)

const realFilename = parseTakealotFilename(
  'shipping_note_PO_29896140_13_08_2026_CPT_1.pdf',
)
assert.equal(realFilename.sellerId, '29896140')
assert.equal(realFilename.sourceDate, '2026-08-13')
assert.equal(realFilename.warehouseCode, 'cpt1')
assert.equal(realFilename.warehouseConfidence, 'generic')
assert.equal(realFilename.shipmentName, 'PO-29896140-13/08/2026-CPT-1')
assert.equal(
  detectTakealotDocKind(
    'shipping_labels_PO_29896140_13_08_2026_CPT_1.pdf',
    'Marketplace Shipment\nBox _____ of _____',
  ),
  '外箱标',
)

const realManifest = parseTakealotDocumentText(`
Due Date: 2026/08/19
PO Number: 184505024
Seller ID: 29896140
Created by Adams James John for Takealot
9902297558367 102097826 9902297558367 1
9902297558374 102097827 9902297558374 2
9902297561725 102169664 9902297561725 2
9902297574756 102536256 9902297574756 1
9902418052194 105037488 9902418052194 5
`, '发货清单')
assert.deepEqual(
  realManifest.lineItems?.map(item => [item.barcode, item.sku, item.expectedQty]),
  [
    ['9902297558367', '9902297558367', 1],
    ['9902297558374', '9902297558374', 2],
    ['9902297561725', '9902297561725', 2],
    ['9902297574756', '9902297574756', 1],
    ['9902418052194', '9902418052194', 5],
  ],
)

const realBooking = parseTakealotDocumentText(`
Booking Confirmation Adams James John
Date of Booking: Aug 20, 2026
Time Slot: 12:00
Cape Town DC
Booking Reference Number: TALBWDBYN5231740
Included POs ASN Numbers Qty PO Type
TAL MP 184505024 ASNCPTMP184505024 11 Stock
Total units on delivery: 11
`, '预约单')
const realMerged = mergeTakealotParsed(realFilename, realManifest, realBooking)
assert.equal(realMerged.poNumber, '184505024')
assert.equal(realMerged.asnNumber, 'ASNCPTMP184505024')
assert.equal(realMerged.bookingRef, 'TALBWDBYN5231740')
assert.equal(realMerged.totalUnits, 11)
assert.equal(realMerged.shipmentDate, '2026-08-19')
assert.deepEqual(takealotParseWarnings(realMerged), [
  '预约日期 2026-08-20 晚于 Due Date 2026-08-19',
])

const expectedVsObserved = mergeTakealotParsed(
  {
    sources: ['manifest'],
    lineItems: [{ sku: '9902297558367', barcode: '9902297558367', qty: 1, expectedQty: 1 }],
  },
  {
    sources: ['labels'],
    lineItems: [{ sku: '9902297558367', barcode: '9902297558367', qty: 2, observedLabelCount: 2 }],
  },
)
assert.equal(expectedVsObserved.lineItems[0].qty, 1)
assert.equal(expectedVsObserved.lineItems[0].expectedQty, 1)
assert.equal(expectedVsObserved.lineItems[0].observedLabelCount, 2)

console.log('Takealot parser verification passed')
