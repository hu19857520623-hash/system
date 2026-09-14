import assert from 'node:assert/strict'
import {
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  takealotIdentityConflicts,
  takealotMissingFields,
  takealotParseConflicts,
  takealotParseWarnings,
} from '../src/data/takealotDocParser'
import { applyTakealotShippingNoteBindings } from '../src/data/takealotAutoBind'
import { productMatchesSellerSku } from '../src/data/skuCode'

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
assert.ok(takealotIdentityConflicts([manifest, conflict]).some(item => item.includes('PO 单号')))

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
assert.deepEqual(
  takealotIdentityConflicts([realFilename, realManifest, realBooking]),
  [],
  'filename _PO_{sellerId}_ must not be treated as a conflicting PO number',
)

const shippingNoteText = `
27/08/2026
Created by CHIMS (PTY) LTD for Takealot
Shipment Name: PO-29899395-26/08/2026-CPT-1
Shipping Note
Due Date: 2026/09/02
Seller ID: 29899395
PO Number: 185849749
SHIPMENT CONTENT
MP Takealot Barcode
Product Title
TSIN
SKU
Units
9902347546344
Adjustable Multifunction
Weight Bench with 6-Position
Headrest, Easy Setup.
103886453
FIT-WEI-WEI-004
2
9902348915149
16 lb Adjustable Weighted
Vest with Reflective
Breathable Fabric, Home Use. 103935319
FIT-STR-WEI-002
2
9902351474473
12 lb Adjustable Weighted
Vest for Running and Strength
Training, Home Use.
103998930
FIT-STR-WEI-001
2
9902352388229
Blue Portable Beach Umbrella
with Double-Layer UV
Canopy, Sturdy Pole ready
104016188
OUT-TEN-GAR-005 2
9902354342106
3m Golf Practice Net Set with
Mat, Balls, PU Balls and Tee,
Carry Friendly.
104095549
SPO-GOL-NET-001 2
9902355506408
Kids Foldable Soccer Goal
Set with Agility Ladder,
Ground Stakes and Cones.
104115157
SPO-SOC-GOA-001 2
9902374765756
Gray Single Condo Cat Tree
with Soft Plush Indoor
Climbing Tower, Home Use.
104438153
PET-CAT-TRE-010
2
Page 1 of 2
MP Takealot Barcode
Product Title
TSIN
SKU
Units
9902374812818
Multi-Purpose Kitchen
Vegetable Storage Organizer
Rack, Fruit Storage ready
104439093
FUR-KIT-CAR-007
2
9902378225027
Kids Hanging Swing Seat for
Indoor and Outdoor Toddler
Play, Toddler Swing.
104500271
TOY-OUT-SWI-007 2
9902378265726
Reinforced Triangular
Wall-Mounted Heavy Bag
Bracket, Punching Bag for
home
104501862
FIT-COM-PUN-002
2
9902378390305
4-Tier Gray Dog Foam Stairs
Pet Climbing Steps
104504977
PET-PET-RAM-006 2
9902380185319
Universal 32-85 Inch TV Wall
Mount Bracket 45KG Load
104522313
ELE-TVA-FIX-003
2
9902380185852
Heavy Duty TV Wall Mount
Fits 40 to 85 Inch LED LCD
OLED Smart TVs
104522315
ELE-TVA-FIX-004
2
9902389244222
5-Tier Simple Storage Rack
Kitchen Bedroom Home
Organizer
104694957
FUR-LVR-BOO-036 2
9902416567041
Large Tear-Resistant Fabric
Tent Storage Bag, Portable
Carry Pouch
105029115
OUT-TEN-ACC-001 2
Page 2 of 2
`
const shippingNote = parseTakealotDocumentText(shippingNoteText, '发货清单')
assert.equal(shippingNote.poNumber, '185849749')
assert.equal(shippingNote.sellerId, '29899395')
assert.deepEqual(
  shippingNote.lineItems?.map(item => [item.barcode, item.sku, item.expectedQty]),
  [
    ['9902347546344', 'FIT-WEI-WEI-004', 2],
    ['9902348915149', 'FIT-STR-WEI-002', 2],
    ['9902351474473', 'FIT-STR-WEI-001', 2],
    ['9902352388229', 'OUT-TEN-GAR-005', 2],
    ['9902354342106', 'SPO-GOL-NET-001', 2],
    ['9902355506408', 'SPO-SOC-GOA-001', 2],
    ['9902374765756', 'PET-CAT-TRE-010', 2],
    ['9902374812818', 'FUR-KIT-CAR-007', 2],
    ['9902378225027', 'TOY-OUT-SWI-007', 2],
    ['9902378265726', 'FIT-COM-PUN-002', 2],
    ['9902378390305', 'PET-PET-RAM-006', 2],
    ['9902380185319', 'ELE-TVA-FIX-003', 2],
    ['9902380185852', 'ELE-TVA-FIX-004', 2],
    ['9902389244222', 'FUR-LVR-BOO-036', 2],
    ['9902416567041', 'OUT-TEN-ACC-001', 2],
  ],
)

const shippingNotePdfJsRow = parseTakealotDocumentText(`
SHIPMENT CONTENT
9902348915149 Breathable Fabric, Home Use. 103935319 FIT-STR-WEI-002 2
9902352388229 104016188 OUT-TEN-GAR-005 2
`, '发货清单')
assert.deepEqual(
  shippingNotePdfJsRow.lineItems?.map(item => [item.barcode, item.sku, item.expectedQty]),
  [
    ['9902348915149', 'FIT-STR-WEI-002', 2],
    ['9902352388229', 'OUT-TEN-GAR-005', 2],
  ],
)

assert.equal(productMatchesSellerSku({
  internalSku: 'CHI0001-FIT-WEI-WEI-004',
  customerSku: 'FIT-WEI-WEI-004',
}, 'FIT-WEI-WEI-004'), true)
assert.equal(productMatchesSellerSku({
  internalSku: 'CHI0001-FIT-WEI-WEI-004',
}, 'FIT-WEI-WEI-004'), true)

const autoBind = applyTakealotShippingNoteBindings({
  items: shippingNote.lineItems || [],
  mappings: [],
  products: [
    { internalSku: 'CHI0001-FIT-WEI-WEI-004', customerSku: 'FIT-WEI-WEI-004', customerId: 'c-chims', name: 'Weight Bench' },
    { internalSku: 'CHI0001-OUT-TEN-GAR-005', customerSku: 'OUT-TEN-GAR-005', customerId: 'c-chims', name: 'Beach Umbrella' },
  ],
  customerId: 'c-chims',
  sellerId: '29899395',
  stockSource: 'owned',
  now: '2026-09-14',
})
assert.equal(autoBind.bound.length, 2)
assert.equal(autoBind.unmatchedSkus.length, 13)
assert.deepEqual(
  autoBind.mappings.map(mapping => [mapping.platformBarcode, mapping.lines[0]?.internalSku]),
  [
    ['9902347546344', 'CHI0001-FIT-WEI-WEI-004'],
    ['9902352388229', 'CHI0001-OUT-TEN-GAR-005'],
  ],
)
const alreadyBound = applyTakealotShippingNoteBindings({
  items: shippingNote.lineItems || [],
  mappings: autoBind.mappings,
  products: [
    { internalSku: 'CHI0001-FIT-WEI-WEI-004', customerSku: 'FIT-WEI-WEI-004', customerId: 'c-chims', name: 'Weight Bench' },
    { internalSku: 'CHI0001-OUT-TEN-GAR-005', customerSku: 'OUT-TEN-GAR-005', customerId: 'c-chims', name: 'Beach Umbrella' },
  ],
  customerId: 'c-chims',
  sellerId: '29899395',
  stockSource: 'owned',
  now: '2026-09-14',
})
assert.equal(alreadyBound.bound.length, 0)
assert.equal(alreadyBound.mappings.length, 2)

const otherPo = parseTakealotDocumentText(
  'PO Number: 111111111\nSeller ID: 29896140\nIncluded POs: 111111111',
  '发货清单',
)
assert.ok(
  takealotIdentityConflicts([realManifest, otherPo]).some(item => item.includes('PO 单号')),
  'a second file with a different PO must be rejected',
)

const otherSeller = parseTakealotDocumentText(
  'PO Number: 184505024\nSeller ID: 11111111',
  '发货清单',
)
assert.ok(
  takealotIdentityConflicts([realManifest, otherSeller]).some(item => item.includes('Seller ID')),
)

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
