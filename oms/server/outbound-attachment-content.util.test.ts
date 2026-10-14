import test from 'node:test'
import assert from 'node:assert/strict'
import { requireOutboundAttachmentContent } from './outbound-attachment-content.util.js'

test('all original PDFs, images and spreadsheets preserve their bytes for ERP', () => {
  for (const [name, mime] of [['note.pdf', 'application/pdf'], ['label.png', 'image/png'], ['list.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) {
    const bytes = Buffer.from([0, 1, 127, 255, 10, 13])
    const encoded = bytes.toString('base64')
    assert.equal(requireOutboundAttachmentContent({ fileName: name, url: `data:${mime};base64,${encoded}` }, 0), encoded)
    assert.deepEqual(Buffer.from(requireOutboundAttachmentContent({ fileName: name, contentBase64: encoded }, 0), 'base64'), bytes)
  }
})

test('missing file content rejects the request instead of silently dropping a file', () => {
  for (const url of ['', 'https://example.com/note.pdf', 'data:application/pdf;base64,']) {
    assert.throws(() => requireOutboundAttachmentContent({ fileName: 'note.pdf', url }, 0), /note.pdf.*重新上传/)
  }
  assert.throws(() => requireOutboundAttachmentContent({}, 2), /附件 3 缺少文件名/)
})
