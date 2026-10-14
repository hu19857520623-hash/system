import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extractPdfTextModelFromData } from '../src/data/takealotPdfText'
import { detectTakealotDocKind, mergeTakealotParsed, takealotIdentityConflicts, takealotMissingFields } from '../src/data/takealotDocParser'
import { parseTakealotDocumentModel } from '../src/data/takealotShipmentPdf'
import { parseTakealotProductLabelPdf } from '../src/data/takealotLabelPdf'

const root = process.env.TFS_PDF_ROOT || process.argv[2]
if (!root) throw new Error('Set TFS_PDF_ROOT or provide the PDF directory as the first argument')
const names = ['shipping_note_990_JM_543_DBN.pdf', 'shipping_labels_990_JM_543_DBN(1).pdf', 'product_labels_990_JM_543_DBN.pdf', 'Stickers_25_GLJJTT(2).pdf']
const parts = []
const labels = new Map<string, number>()
await mkdir('output/tfs-analysis', { recursive: true })
for (const [index, name] of names.entries()) {
  const bytes = await readFile(`${root}/${name}`)
  const model = await extractPdfTextModelFromData(new Uint8Array(bytes))
  const kind = detectTakealotDocKind(name, model.text)
  assert.equal(kind, ['发货清单', '外箱标', 'SKU 标签', 'TFS 面单'][index])
  parts.push(parseTakealotDocumentModel(model, kind))
  if (kind === '发货清单') {
    await writeFile('output/tfs-analysis/shipping-note-model.json', JSON.stringify(model))
  }
  if (kind === 'SKU 标签') {
    const parsed = await parseTakealotProductLabelPdf(new File([bytes], name, { type: 'application/pdf' }))
    assert.deepEqual(parsed.blockingStates, [])
    for (const crop of parsed.crops) labels.set(crop.barcode, (labels.get(crop.barcode) || 0) + 1)
  }
}
assert.deepEqual(takealotIdentityConflicts(parts), [])
const merged = mergeTakealotParsed(...parts)
assert.deepEqual(takealotMissingFields(merged, 'tfs'), [])
assert.equal(merged.poNumber, '190035967')
assert.equal(merged.courierReference, 'GLJJTT')
assert.equal(merged.parcelCount, 3)
assert.deepEqual(merged.lineItems.map(item => [item.barcode, item.sku, item.qty]), [
  ['9902233754839', '710672', 1], ['9902248850526', '710695-2', 1], ['9902274186071', '710515-2', 1],
])
for (const item of merged.lineItems) assert.equal(labels.get(item.barcode!), 1)
assert.match(merged.lineItems[0].productTitle!, /Holds 14 Club/)
assert.ok(!merged.lineItems[1].productTitle!.includes('Bag-'))
await writeFile('output/tfs-analysis/parsed-result.json', JSON.stringify(merged, null, 2))
console.log(JSON.stringify({ result: 'passed', ...merged, labels: [...labels] }, null, 2))
