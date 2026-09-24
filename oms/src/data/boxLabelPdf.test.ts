import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { buildBoxLabelsPdf } from './boxLabelPdf.ts'
import { buildBoxLabelArticle } from './boxLabelTemplate.ts'

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

  const pdf = await PDFDocument.load(await buildBoxLabelsPdf([label]))
  const { width, height } = pdf.getPage(0).getSize()
  assert.ok(Math.abs(width - 100 * 72 / 25.4) < 0.01)
  assert.equal(width, height)
})
