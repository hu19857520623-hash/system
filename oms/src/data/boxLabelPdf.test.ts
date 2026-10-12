import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { buildBoxLabelsPdf } from './boxLabelPdf.ts'
import { buildBoxLabelArticle, buildBoxLabelsHtml } from './boxLabelTemplate.ts'
import { buildCartonCode } from './wmsDocNo.ts'

test('builds a 100mm square box-label PDF without country-of-origin text', async () => {
  const label = {
    referenceNo: 'RVTKL005-260924-0001',
    boxNo: 1,
    warehouseCode: 'WMS-JHB-01',
    boxIndex: 1,
    boxTotal: 10,
    lines: [{ sku: 'TKL005-713091', qty: 18 }],
  }
  const article = buildBoxLabelArticle(label)
  assert.doesNotMatch(article, /MADE IN CHINA/i)
  assert.match(article, /RVTKL005-260924-0001-1/)
  assert.match(article, /class="sku-barcode".*aria-label="TKL005-713091"/)
  assert.equal(buildCartonCode(label.referenceNo, 3), 'RVTKL005-260924-0001-3')

  const pdf = await PDFDocument.load(await buildBoxLabelsPdf([label]))
  const { width, height } = pdf.getPage(0).getSize()
  assert.ok(Math.abs(width - 100 * 72 / 25.4) < 0.01)
  assert.equal(width, height)
})

test('mixed-carton SKU barcodes continue on square pages without losing quantities', async () => {
  const label = {
    referenceNo: 'RVTKL005-260924-0002', boxNo: 2, warehouseCode: 'WMS-JHB-01', boxTotal: 2,
    lines: Array.from({ length: 5 }, (_, i) => ({ sku: `TKL005-71309${i}`, qty: i + 1 })),
  }
  const html = buildBoxLabelsHtml([label])
  assert.equal((html.match(/class="box-label"/g) || []).length, 3)
  assert.equal((html.match(/class="sku-barcode"/g) || []).length, 5)
  for (const line of label.lines) assert.ok(html.includes(`aria-label="${line.sku}"`))
  const pdf = await PDFDocument.load(await buildBoxLabelsPdf([label]))
  assert.equal(pdf.getPageCount(), 3)
})
