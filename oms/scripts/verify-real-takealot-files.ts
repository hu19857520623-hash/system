/** Validate a real four-file Takealot shipment before an OMS end-to-end run.
 *
 * Usage: npm run verify:takealot:files -- <outer-label.pdf> <booking.pdf>
 *        <shipping-note.pdf> <product-label.pdf>
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  takealotMissingFields,
  takealotParseConflicts,
  type TakealotParsedDoc,
} from '../src/data/takealotDocParser'
import { parseTakealotProductLabelPdf } from '../src/data/takealotLabelPdf'
import { extractPdfTextModelFromData } from '../src/data/takealotPdfText'

const paths = process.argv.slice(2)
assert.equal(paths.length, 4, '请依次提供外箱标、预约单、发货清单、商品标签四份真实 PDF 路径')

const expectedKinds = ['外箱标', '预约单', '发货清单', 'SKU 标签'] as const
const parts: Partial<TakealotParsedDoc>[] = []
const observedLabels = new Map<string, number>()

for (const [index, path] of paths.entries()) {
  const name = basename(path)
  const bytes = await readFile(path)
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-', `${name} 不是 PDF 文件`)
  const model = await extractPdfTextModelFromData(new Uint8Array(bytes))
  assert.ok(model.pageCount > 0 && model.text.trim(), `${name} 没有可识别的 PDF 文字`)
  const kind = detectTakealotDocKind(name, model.text)
  assert.equal(kind, expectedKinds[index], `${name} 文件类型识别错误`)
  parts.push(parseTakealotFilename(name), parseTakealotDocumentText(model.text, kind))

  if (kind === 'SKU 标签') {
    const result = await parseTakealotProductLabelPdf(
      new File([bytes], name, { type: 'application/pdf' }),
    )
    assert.equal(result.status, 'ok', result.blockingStates.map(state => state.message).join('；'))
    assert.ok(result.crops.length > 0, `${name} 没有裁出商品标签`)
    for (const crop of result.crops) {
      observedLabels.set(crop.barcode, (observedLabels.get(crop.barcode) || 0) + 1)
    }
    parts.push({
      sources: [`labels:${name}`],
      lineItems: [...observedLabels].map(([barcode, qty]) => ({
        sku: barcode,
        barcode,
        qty,
        observedLabelCount: qty,
      })),
    })
  }
}

assert.deepEqual(takealotParseConflicts(parts), [], '四份文件的身份或数量字段存在冲突')
const merged = mergeTakealotParsed(...parts)
assert.deepEqual(takealotMissingFields(merged), [], '四份文件缺少必填字段')
assert.equal(merged.totalUnits, merged.lineItems.reduce((sum, item) => sum + item.qty, 0),
  '预约单送货件数与发货清单不一致')
assert.equal(observedLabels.size, merged.lineItems.length, '商品标签 SKU 种类与发货清单不一致')
const shippingItems = parts
  .filter(part => part.sources?.includes('text:发货清单'))
  .flatMap(part => part.lineItems || [])
for (const item of merged.lineItems) {
  assert.ok(item.barcode, `SKU ${item.sku} 没有 990 条码`)
  assert.equal(item.sku, shippingItems.find(source => source.barcode === item.barcode)?.sku,
    `条码 ${item.barcode} 覆盖了发货清单中的客户 SKU`)
  assert.equal(observedLabels.get(item.barcode), item.qty,
    `SKU ${item.sku} 的标签张数与发货清单数量不一致`)
}

console.log(JSON.stringify({
  result: 'passed',
  poNumber: merged.poNumber,
  sellerId: merged.sellerId,
  warehouseCode: merged.warehouseCode,
  appointmentDate: merged.appointmentDate,
  bookingRef: merged.bookingRef,
  skuCount: merged.lineItems.length,
  unitCount: merged.totalUnits,
  labels: observedLabels.size,
  items: merged.lineItems.map(item => ({ sku: item.sku, barcode: item.barcode, qty: item.qty })),
}, null, 2))
