import { describe, expect, it } from 'vitest'
import { downloadableOutboundSourceAttachments, isOutboundSourceAttachment } from './attachments'

describe('original outbound uploads', () => {
  it('exposes all four originals and miscellaneous files without generated label crops', () => {
    const originals = ['outerLabel', 'deliveryList', 'appointment', 'skuLabel', 'other'].map(fileType => ({ fileType, fileName: `${fileType}.pdf`, labelRole: 'sourceDocument', downloadable: true }))
    const crops = [{ fileType: 'skuLabel', labelRole: 'unitCrop', downloadable: true }, { fileType: 'skuLabel', sku: 'A', unitIndex: 1, downloadable: true }]
    expect(downloadableOutboundSourceAttachments([...originals, ...crops])).toEqual(originals)
    expect(isOutboundSourceAttachment({ fileType: 'skuLabel' })).toBe(true)
    expect(downloadableOutboundSourceAttachments([{ fileType: 'other', downloadable: false }])).toEqual([])
  })
})
