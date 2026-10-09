import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBarcodeLabelsHtml } from './barcodeLabelTemplate.ts'
import { buildSelectableBoxLabelHtml } from './selectableBoxLabelPrint.ts'

test('SKU print formats encode the same customer SKU and preserve copies', async () => {
  for (const type of ['qr', 'barcode'] as const) {
    const html = await buildBarcodeLabelsHtml([{ code: 'ABC-123', copies: 2 }], 'SKU 标签', type)
    assert.equal((html.match(/<article /g) ?? []).length, 2)
    assert.equal((html.match(/<p class="code">ABC-123<\/p>/g) ?? []).length, 2)
    assert.equal(html.includes('<svg class="qr"'), type === 'qr')
  }
})

test('mixed SKU box print changes every code to QR and keeps box identity and quantities', async () => {
  const labels = [{ referenceNo: 'IN-TEST', boxNo: 2, warehouseCode: 'JHB', boxTotal: 3, lines: [{ sku: 'SKU-A', qty: 2 }, { sku: 'SKU-B', qty: 5 }, { sku: 'SKU-C', qty: 1 }] }]
  const html = await buildSelectableBoxLabelHtml(labels, 'qr')
  assert.equal((html.match(/<article /g) ?? []).length, 2)
  assert.equal((html.match(/<svg class="qr"/g) ?? []).length, 5)
  for (const sku of ['SKU-A', 'SKU-B', 'SKU-C']) assert.ok(html.includes(sku))
  assert.ok(html.includes('<td>5</td>'))
  assert.ok(html.includes('2/3'))
  const barcodeHtml = await buildSelectableBoxLabelHtml(labels, 'barcode')
  assert.equal(barcodeHtml.includes('<svg class="qr"'), false)
})

test('unsupported Code128 characters are rejected instead of silently altering the code', async () => {
  await assert.rejects(buildBarcodeLabelsHtml([{ code: '中文SKU' }], 'SKU 标签', 'barcode'), /请选择二维码/)
  assert.ok((await buildBarcodeLabelsHtml([{ code: '中文SKU' }], 'SKU 标签', 'qr')).includes('中文SKU'))
})
