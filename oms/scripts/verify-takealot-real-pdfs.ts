import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  takealotParseConflicts,
  takealotParseWarnings,
} from '../src/data/takealotDocParser'
import { parseTakealotProductLabelPdf } from '../src/data/takealotLabelPdf'
import { extractPdfTextModelFromData } from '../src/data/takealotPdfText'

const root = 'C:/Users/15693/Desktop'
const files = {
  deliveryList: 'shipping_note_PO_29896140_13_08_2026_CPT_1.pdf',
  outerLabel: 'shipping_labels_PO_29896140_13_08_2026_CPT_1.pdf',
  skuLabel: 'product_labels_PO_29896140_13_08_2026_CPT_1.pdf',
  appointment: 'TALBWDBYN5231740.pdf',
}

const parts = []
for (const fileName of Object.values(files)) {
  const bytes = new Uint8Array(await readFile(`${root}/${fileName}`))
  const model = await extractPdfTextModelFromData(bytes)
  const kind = detectTakealotDocKind(fileName, model.text)
  parts.push(parseTakealotFilename(fileName), parseTakealotDocumentText(model.text, kind))
}

const parsed = mergeTakealotParsed(...parts)
assert.equal(parsed.sellerId, '29896140')
assert.equal(parsed.poNumber, '184505024')
assert.equal(parsed.asnNumber, 'ASNCPTMP184505024')
assert.equal(parsed.bookingRef, 'TALBWDBYN5231740')
assert.equal(parsed.totalUnits, 11)
assert.equal(parsed.shipmentDate, '2026-08-19')
assert.deepEqual(
  parsed.lineItems.map(item => [item.barcode, item.expectedQty]),
  [
    ['9902297558367', 1],
    ['9902297558374', 2],
    ['9902297561725', 2],
    ['9902297574756', 1],
    ['9902418052194', 5],
  ],
)
assert.deepEqual(takealotParseConflicts(parts), [])
assert.deepEqual(takealotParseWarnings(parsed), [
  '预约日期 2026-08-20 晚于 Due Date 2026-08-19',
])

const labelBytes = await readFile(`${root}/${files.skuLabel}`)
const labelFile = new File([labelBytes], files.skuLabel, { type: 'application/pdf' })
const labels = await parseTakealotProductLabelPdf(labelFile)
assert.equal(labels.status, 'ok')
assert.deepEqual(labels.blockingStates, [])
assert.equal(labels.crops.length, 11)
assert.ok(Math.abs(labels.grid.cellWidth - 113.386) < 0.01)
assert.ok(Math.abs(labels.grid.cellHeight - 84.756) < 0.01)
assert.ok(Math.abs(labels.grid.left - 14.173) < 0.01)
assert.ok(Math.abs(labels.grid.bottom - 39.543) < 0.01)
assert.deepEqual(
  labels.crops.map(crop => [crop.row, crop.column, crop.barcode, crop.unitIndex]),
  [
    [0, 0, '9902297558367', 1],
    [0, 1, '9902297558374', 1],
    [0, 2, '9902297558374', 2],
    [0, 3, '9902297561725', 1],
    [0, 4, '9902297561725', 2],
    [1, 0, '9902297574756', 1],
    [1, 1, '9902418052194', 1],
    [1, 2, '9902418052194', 2],
    [1, 3, '9902418052194', 3],
    [1, 4, '9902418052194', 4],
    [2, 0, '9902418052194', 5],
  ],
)
assert.ok(labels.crops.every(crop => crop.dataUrl.startsWith('data:application/pdf;base64,')))

console.log('Real Takealot PDF verification passed')
