import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreTakealotDraftAttachments } from './takealotDraftRestore.ts'
import type { FileAttachment } from './mockData.ts'
import type { TakealotLabelPdfResult } from './takealotLabelPdf.ts'

const source = (kind: string, fileName: string, text = 'PDF fixture'): FileAttachment => ({
  kind, fileName, uploadedAt: '2026-10-08', url: `data:application/pdf;base64,${Buffer.from(text).toString('base64')}`,
})
const labels: TakealotLabelPdfResult = {
  status: 'ok', pageCount: 1, blockingStates: [],
  grid: { columns: 5, maxRows: 9, cellWidth: 1, cellHeight: 1,
    left: 0, bottom: 0, inferredColumnStep: 1, inferredRowStep: 1 },
  crops: [{ barcode: '9902380084674', fileName: 'unit.png', unitIndex: 1,
    page: 1, row: 0, column: 0, dataUrl: 'data:image/png;base64,YQ==',
    bounds: { left: 0, bottom: 0, width: 1, height: 1 } }],
}

test('reopening a draft reconstructs parsed documents and source attachment roles', async () => {
  const result = await restoreTakealotDraftAttachments([source('appointment', 'booking.pdf')], {
    extractText: async () => `Booking Confirmation
Date of Booking: Sep 29, 2026
Booking Reference Number: TALBMWDXU5395063
Delivery Details:
TAL MP 188734430 ASNJHBMP188734430 1 Customer
Total units on delivery: 1
Total units to collect: 0`,
    parseLabels: async () => { throw new Error('Not a label file') },
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.parsed?.poNumber, '188734430')
  assert.equal(result.parsed?.totalUnits, 1)
  assert.equal(result.parts.size, 1)
  assert.equal(result.attachments[0].fileType, 'appointment')
  assert.equal(result.attachments[0].labelRole, 'sourceDocument')
})

test('saved unit labels are recropped without duplicates even when PDF text extraction fails', async () => {
  const pdf = source('skuLabel', 'labels.pdf')
  const oldCrop: FileAttachment = { ...pdf, fileName: 'old.png', labelRole: 'unitCrop', localStorageRef: pdf.fileName }
  const result = await restoreTakealotDraftAttachments([pdf, oldCrop], {
    extractText: async () => { throw new Error('Scanned label sheet') },
    parseLabels: async () => labels,
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.labelResults[pdf.fileName], labels)
  assert.equal(result.parsed?.lineItems[0].observedLabelCount, 1)
  const crops = result.attachments.filter(a => a.labelRole === 'unitCrop')
  assert.equal(crops.length, 1)
  assert.equal(crops[0].platformBarcode, '9902380084674')
  assert.equal(crops[0].sourceRow, 1)
  assert.equal(crops[0].localStorageRef, pdf.fileName)
})

test('unreadable source files cannot regain a passed validation state', async () => {
  const result = await restoreTakealotDraftAttachments([{ ...source('deliveryList', 'manifest.pdf'), url: 'data:broken' }], {
    extractText: async () => '', parseLabels: async () => labels,
  })
  assert.equal(result.parsed, null)
  assert.equal(result.parts.size, 0)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /manifest.pdf.*草稿附件校验失败/)
})

test('label blocking states survive restoration instead of bypassing validation', async () => {
  const blocked: TakealotLabelPdfResult = { ...labels, status: 'blocked',
    blockingStates: [{ code: 'invalid-barcode', message: '无法识别条码' }] }
  const result = await restoreTakealotDraftAttachments([source('skuLabel', 'labels.pdf')], {
    extractText: async () => '', parseLabels: async () => blocked,
  })
  assert.deepEqual(result.labelResults['labels.pdf'].blockingStates, blocked.blockingStates)
})
