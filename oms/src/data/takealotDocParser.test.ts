import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseTakealotDocumentModel } from './takealotShipmentPdf.ts'
import type { TakealotPdfTextModel } from './takealotPdfText.ts'
import { detectTakealotDocKind, mergeTakealotParsed, parseTakealotDocumentText, takealotIdentityConflicts, takealotLabelPresenceIssues, takealotMissingFields } from './takealotDocParser.ts'

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

test('each shipment barcode needs only one usable label template', () => {
  assert.deepEqual(takealotLabelPresenceIssues(14, 1), [])
  assert.deepEqual(takealotLabelPresenceIssues(7, 1), [])
  assert.deepEqual(takealotLabelPresenceIssues(1, 7), [])
  assert.deepEqual(takealotLabelPresenceIssues(14, 0), ['缺少 1 张可用标签'])
  assert.deepEqual(takealotLabelPresenceIssues(0, 1), ['清单中没有此条码'])
})

for (const layout of ['rows', 'split'] as const) {
  test(`shipping note reads Units without counting title numbers or SKU digits (${layout})`, () => {
    const rows = [
      '9902233754839 Lightweight Double Shoulder 14 Inch Golf Stand 103886453 BAG-14 1',
      '9902248850526 Fitness Wall Mounted Pull Up Bar 7 Position 103935319 CHIN-7 1',
      '9902274186071 7 Inch Smart Auto Balance Hoverboard 103998930 710515-2 1',
    ]
    const text = 'Shipping Note\nSHIPMENT CONTENT\nMP Takealot Barcode Product Title TSIN SKU Units\n'
      + rows.map(row => layout === 'split' ? row.split(' ').join('\n') : row).join('\n')
      + '\nPage 1 of 1'
    const parsed = parseTakealotDocumentText(text, '发货清单')
    assert.deepEqual(parsed.lineItems?.map(item => [item.sku, item.expectedQty]), [
      ['BAG-14', 1], ['CHIN-7', 1], ['710515-2', 1],
    ])
  })
}

test('shipment quantities stay authoritative with one or repeated labels in either upload order', () => {
  const shipping = parseTakealotDocumentText(
    'SHIPMENT CONTENT\n9902233754839 Golf Stand 103886453 BAG-14 14\n9902248850526 Pull Up Bar 103935319 CHIN-7 7',
    '发货清单',
  )
  for (const count of [1, 20]) {
    const labels = { lineItems: shipping.lineItems!.map(item => ({
      sku: item.barcode!, barcode: item.barcode, qty: count, observedLabelCount: count,
    })) }
    for (const parts of [[shipping, labels], [labels, shipping]]) {
      const merged = mergeTakealotParsed(...parts)
      assert.deepEqual(merged.lineItems.map(item => [item.sku, item.qty, item.expectedQty]), [
        ['BAG-14', 14, 14], ['CHIN-7', 7, 7],
      ])
    }
  }
})

test('other document kinds cannot supply shipment quantities from numeric text', () => {
  for (const kind of ['SKU 标签', '预约单', '外箱标']) {
    const parsed = parseTakealotDocumentText('SKU: BAG-14 Qty: 99\n103886453BAG-141', kind)
    assert.deepEqual(parsed.lineItems, [])
  }
})

const tfsShippingText = readFileSync(new URL('./fixtures/tfs-shipping-note.txt', import.meta.url), 'utf8')
const tfsCourierText = readFileSync(new URL('./fixtures/tfs-courier-label.txt', import.meta.url), 'utf8')
const tfsShippingModel: TakealotPdfTextModel = JSON.parse(readFileSync(new URL('./fixtures/tfs-shipping-note-model.json', import.meta.url), 'utf8'))

test('PDF table coordinates preserve wrapped titles and the Units column', () => {
  const parsed = parseTakealotDocumentModel(tfsShippingModel, '发货清单')
  assert.deepEqual(parsed.lineItems?.map(item => item.qty), [1, 1, 1])
  assert.match(parsed.lineItems![0].productTitle!, /Holds 14 Club/)
  assert.match(parsed.lineItems![1].productTitle!, /^Fitness Wall/)
  assert.match(parsed.lineItems![2].productTitle!, /^7 Inch/)
  assert.equal(parsed.parsingIssues, undefined)
})

test('unreadable PDF Units block validation instead of falling back to a title number', () => {
  const model = structuredClone(tfsShippingModel)
  const units = model.pages[0].tokens.find(token => /^Units$/i.test(token.text))!
  model.pages[0].tokens = model.pages[0].tokens.filter(token => !(token.text === '1' && token.x >= units.x - 3))
  const parsed = parseTakealotDocumentModel(model, '发货清单')
  assert.deepEqual(parsed.lineItems, [])
  assert.equal(parsed.parsingIssues?.length, 3)
})

test('actual 990-JM-543-DBN note has three numeric seller SKUs with one unit each', () => {
  const parsed = parseTakealotDocumentText(tfsShippingText, '发货清单')
  assert.equal(parsed.poNumber, '190035967')
  assert.equal(parsed.warehouseCode, 'dbn')
  assert.deepEqual(parsed.lineItems?.map(item => [item.barcode, item.sku, item.expectedQty]), [
    ['9902233754839', '710672', 1], ['9902248850526', '710695-2', 1], ['9902274186071', '710515-2', 1],
  ])
})

test('three-page TFS courier label supplies delivery fields without fake shipment quantities', () => {
  const kind = detectTakealotDocKind('Stickers_25_GLJJTT(2).pdf', tfsCourierText)
  assert.equal(kind, 'TFS 面单')
  const parsed = parseTakealotDocumentText(tfsCourierText, kind)
  assert.equal(parsed.poNumber, '190035967')
  assert.equal(parsed.sellerId, '29889711')
  assert.equal(parsed.courierReference, 'GLJJTT')
  assert.equal(parsed.earliestDeliveryDate, '2026-10-09')
  assert.equal(parsed.appointmentDate, undefined)
  assert.equal(parsed.parcelCount, 3)
  assert.deepEqual(parsed.lineItems, [])
  assert.equal(parsed.recipient?.city, 'Durban')
  assert.equal(parsed.recipient?.postalCode, '4019')
  assert.equal(parsed.recipient?.phone, undefined)
  const shipping = parseTakealotDocumentText(tfsShippingText, '发货清单')
  const merged = mergeTakealotParsed(shipping, parsed)
  assert.deepEqual(takealotMissingFields(merged, 'tfs'), [])
  assert.equal(merged.lineItems.reduce((sum, item) => sum + item.qty, 0), 3)
  assert.deepEqual(takealotIdentityConflicts([shipping, parsed]), [])
  const wrongPo = parseTakealotDocumentText(tfsCourierText.replace(/190035967/g, '190035968'), kind)
  assert.ok(takealotIdentityConflicts([shipping, wrongPo]).some(issue => issue.includes('PO 单号')))
})
