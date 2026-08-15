import {
  OutboundLabelValidationError,
  assertSkuLabelCounts,
  mergePdfBuffers,
  normalizeOmsOutboundAttachments,
  sortStoredLabels,
} from './outbound-label.util'

const PDF_BASE64 = Buffer.from('%PDF-cropped-label').toString('base64')

describe('outbound label utilities', () => {
  it('normalizes OMS label metadata and accepts matching SKU counts', () => {
    const attachments = normalizeOmsOutboundAttachments([
      {
        fileType: 'sku_label',
        fileName: 'sku-a-1.pdf',
        contentBase64: PDF_BASE64,
        sku: 'SKU-A',
        unitIndex: 1,
        platformBarcode: '990000001',
        sourcePage: 0,
        sourceRow: 1,
        sourceColumn: 2,
        labelRole: 'unit',
        contentHash: 'A'.repeat(64),
      },
      {
        fileType: 'SKU Label',
        fileName: 'sku-a-2.pdf',
        contentBase64: PDF_BASE64,
        sku: 'SKU-A',
        unitIndex: 2,
      },
      {
        fileType: 'skuLabel',
        fileName: 'original-label-sheet.pdf',
        contentBase64: PDF_BASE64,
        labelRole: 'sourceDocument',
      },
    ])

    expect(attachments[0]).toMatchObject({
      fileType: 'skuLabel',
      sku: 'SKU-A',
      unitIndex: 1,
      contentHash: 'a'.repeat(64),
    })
    expect(attachments[2]).toMatchObject({
      fileType: 'skuLabel',
      sku: null,
      unitIndex: null,
      labelRole: 'sourceDocument',
    })
    expect(() => assertSkuLabelCounts([{ sku: 'SKU-A', qty: 2 }], attachments)).not.toThrow()
  })

  it('reports each SKU whose cropped-label count does not match quantity', () => {
    const attachments = normalizeOmsOutboundAttachments([
      {
        fileType: 'skuLabel',
        fileName: 'sku-a-1.pdf',
        contentBase64: PDF_BASE64,
        sku: 'SKU-A',
        unitIndex: 1,
      },
    ])

    expect(() => assertSkuLabelCounts([
      { sku: 'SKU-A', qty: 2 },
      { sku: 'SKU-B', qty: 1 },
    ], attachments)).toThrow(
      new OutboundLabelValidationError(
        'SKU 标签数量不匹配：SKU-A 需要 2 张，收到 1 张；SKU-B 需要 1 张，收到 0 张',
      ),
    )
  })

  it('orders the full label set by outbound line then unit index', () => {
    const ordered = sortStoredLabels(
      [
        { id: 4, sku: 'SKU-A', unitIndex: 2 },
        { id: 2, sku: 'SKU-B', unitIndex: 1 },
        { id: 3, sku: 'SKU-A', unitIndex: 1 },
      ],
      ['SKU-A', 'SKU-B'],
    )

    expect(ordered.map((attachment) => attachment.id)).toEqual([3, 4, 2])
  })

  it('merges every source PDF page in input order', async () => {
    const addedPages: string[] = []
    const pdfApi = {
      create: async () => ({
        copyPages: async (source: any, indices: number[]) =>
          indices.map((index) => `${source.name}:${index}`),
        addPage: (page: string) => addedPages.push(page),
        save: async () => Uint8Array.from(Buffer.from(addedPages.join('|'))),
      }),
      load: async (content: Uint8Array) => ({
        name: Buffer.from(content).toString(),
        getPageIndices: () => [0, 1],
      }),
    }

    const merged = await mergePdfBuffers(
      [Buffer.from('first'), Buffer.from('second')],
      pdfApi as any,
    )

    expect(merged.toString()).toBe('first:0|first:1|second:0|second:1')
  })
})
