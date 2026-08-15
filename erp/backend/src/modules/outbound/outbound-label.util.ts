export const OUTBOUND_ATTACHMENT_FILE_TYPES = [
  'outerLabel',
  'skuLabel',
  'deliveryList',
  'appointment',
] as const

const FILE_TYPE_ALIASES: Record<string, (typeof OUTBOUND_ATTACHMENT_FILE_TYPES)[number]> = {
  outerlabel: 'outerLabel',
  shippinglabel: 'outerLabel',
  cartonlabel: 'outerLabel',
  skulabel: 'skuLabel',
  unitlabel: 'skuLabel',
  productlabel: 'skuLabel',
  deliverylist: 'deliveryList',
  deliverynote: 'deliveryList',
  shippingnote: 'deliveryList',
  appointment: 'appointment',
  appointmentfile: 'appointment',
  bookingconfirmation: 'appointment',
}

export function normalizeOutboundAttachmentFileType(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return 'other'
  return FILE_TYPE_ALIASES[raw.replace(/[^a-z0-9]/gi, '').toLowerCase()] || raw
}

export type OutboundAttachmentInput = {
  fileType?: string | null
  fileName: string
  contentBase64: string
  sku?: string | null
  platformBarcode?: string | null
  unitIndex?: number | null
  sourcePage?: number | null
  sourceRow?: number | null
  sourceColumn?: number | null
  labelRole?: string | null
  contentHash?: string | null
}

export type NormalizedOutboundAttachment = {
  fileType: string
  fileName: string
  contentBase64: string
  sku: string | null
  platformBarcode: string | null
  unitIndex: number | null
  sourcePage: number | null
  sourceRow: number | null
  sourceColumn: number | null
  labelRole: string | null
  contentHash: string | null
}

export type StoredLabelAttachment = {
  id: bigint | number
  sku: string | null
  unitIndex: number | null
  sourcePage?: number | null
  sourceRow?: number | null
  sourceColumn?: number | null
}

export class OutboundLabelValidationError extends Error {}

function optionalText(value: unknown, maxLength: number, field: string): string | null {
  if (value == null || String(value).trim() === '') return null
  const result = String(value).trim()
  if (result.length > maxLength) {
    throw new OutboundLabelValidationError(`${field} 最长 ${maxLength} 字符`)
  }
  return result
}

function optionalIndex(
  value: unknown,
  minimum: number,
  field: string,
): number | null {
  if (value == null || value === '') return null
  const result = Number(value)
  if (!Number.isInteger(result) || result < minimum) {
    throw new OutboundLabelValidationError(`${field} 必须是大于等于 ${minimum} 的整数`)
  }
  return result
}

export function decodeAttachmentBase64(contentBase64: string): Buffer {
  const payload = contentBase64.startsWith('data:')
    ? contentBase64.slice(contentBase64.indexOf(',') + 1)
    : contentBase64
  return Buffer.from(payload, 'base64')
}

export function normalizeOmsOutboundAttachments(
  attachments: OutboundAttachmentInput[] | undefined,
): NormalizedOutboundAttachment[] {
  if (!Array.isArray(attachments)) return []
  return attachments.map((attachment, index) => {
    if (!attachment || typeof attachment !== 'object') {
      throw new OutboundLabelValidationError(`附件 ${index + 1} 格式无效`)
    }
    const fileName = String(attachment.fileName || '').trim()
    if (!fileName) throw new OutboundLabelValidationError(`附件 ${index + 1} 缺少 fileName`)
    if (fileName.length > 200) {
      throw new OutboundLabelValidationError(`附件 ${index + 1} fileName 最长 200 字符`)
    }
    const contentBase64 = String(attachment.contentBase64 || '').trim()
    if (!contentBase64) {
      throw new OutboundLabelValidationError(`附件 ${index + 1} 缺少 contentBase64`)
    }
    const fileType = normalizeOutboundAttachmentFileType(attachment.fileType)
    if (fileType.length > 30) {
      throw new OutboundLabelValidationError(`附件 ${index + 1} fileType 最长 30 字符`)
    }
    const sku = optionalText(attachment.sku, 30, `附件 ${index + 1} sku`)
    const unitIndex = optionalIndex(attachment.unitIndex, 1, `附件 ${index + 1} unitIndex`)
    const labelRole = optionalText(attachment.labelRole, 30, `附件 ${index + 1} labelRole`)
    const contentHash = optionalText(attachment.contentHash, 64, `附件 ${index + 1} contentHash`)
    if (contentHash && !/^[a-f0-9]{64}$/i.test(contentHash)) {
      throw new OutboundLabelValidationError(`附件 ${index + 1} contentHash 必须是 64 位 SHA-256`)
    }
    const isUnitCrop =
      fileType === 'skuLabel'
      && (labelRole === 'unitCrop' || sku != null || unitIndex != null)
    if (isUnitCrop) {
      if (!sku) throw new OutboundLabelValidationError(`skuLabel 附件 ${index + 1} 缺少 sku`)
      if (unitIndex == null) {
        throw new OutboundLabelValidationError(`skuLabel 附件 ${index + 1} 缺少 unitIndex`)
      }
      const pdf = decodeAttachmentBase64(contentBase64)
      if (pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new OutboundLabelValidationError(`skuLabel 附件 ${index + 1} 必须是 PDF`)
      }
    }
    return {
      fileType,
      fileName,
      contentBase64,
      sku,
      platformBarcode: optionalText(
        attachment.platformBarcode,
        100,
        `附件 ${index + 1} platformBarcode`,
      ),
      unitIndex,
      sourcePage: optionalIndex(attachment.sourcePage, 0, `附件 ${index + 1} sourcePage`),
      sourceRow: optionalIndex(attachment.sourceRow, 0, `附件 ${index + 1} sourceRow`),
      sourceColumn: optionalIndex(
        attachment.sourceColumn,
        0,
        `附件 ${index + 1} sourceColumn`,
      ),
      labelRole,
      contentHash: contentHash?.toLowerCase() || null,
    }
  })
}

export function assertSkuLabelCounts(
  items: { sku: string; qty: number }[],
  attachments: NormalizedOutboundAttachment[],
) {
  const skuLabels = attachments.filter(
    (attachment) =>
      attachment.fileType === 'skuLabel'
      && attachment.sku != null
      && attachment.unitIndex != null
      && attachment.labelRole !== 'sourceDocument',
  )
  if (!skuLabels.length) return

  const expected = new Map<string, number>()
  for (const item of items || []) {
    const sku = String(item.sku || '').trim()
    if (!sku) continue
    expected.set(sku, (expected.get(sku) || 0) + Math.floor(Number(item.qty) || 0))
  }
  const actual = new Map<string, number>()
  for (const label of skuLabels) {
    const sku = label.sku!
    actual.set(sku, (actual.get(sku) || 0) + 1)
  }

  const mismatches = new Set<string>()
  for (const [sku, qty] of expected) {
    const labelCount = actual.get(sku) || 0
    if (labelCount !== qty) mismatches.add(`${sku} 需要 ${qty} 张，收到 ${labelCount} 张`)
  }
  for (const [sku, labelCount] of actual) {
    if (!expected.has(sku)) mismatches.add(`${sku} 不在出库明细中，但收到 ${labelCount} 张`)
  }
  if (mismatches.size) {
    throw new OutboundLabelValidationError(`SKU 标签数量不匹配：${[...mismatches].join('；')}`)
  }
}

function sortableIndex(value: number | null | undefined) {
  return value == null ? Number.MAX_SAFE_INTEGER : value
}

export function sortStoredLabels<T extends StoredLabelAttachment>(
  attachments: T[],
  outboundLineSkus?: string[],
): T[] {
  const lineOrder = new Map<string, number>()
  ;(outboundLineSkus || []).forEach((sku, index) => {
    if (!lineOrder.has(sku)) lineOrder.set(sku, index)
  })
  return [...attachments].sort((left, right) => {
    if (outboundLineSkus) {
      const lineDifference =
        (lineOrder.get(left.sku || '') ?? Number.MAX_SAFE_INTEGER)
        - (lineOrder.get(right.sku || '') ?? Number.MAX_SAFE_INTEGER)
      if (lineDifference) return lineDifference
    }
    return (
      sortableIndex(left.unitIndex) - sortableIndex(right.unitIndex)
      || sortableIndex(left.sourcePage) - sortableIndex(right.sourcePage)
      || sortableIndex(left.sourceRow) - sortableIndex(right.sourceRow)
      || sortableIndex(left.sourceColumn) - sortableIndex(right.sourceColumn)
      || Number(left.id) - Number(right.id)
    )
  })
}

export function safePdfFilename(...parts: Array<string | number>): string {
  const stem = parts
    .map((part) => String(part).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('_')
    .slice(0, 180) || 'outbound-labels'
  return `${stem.replace(/\.pdf$/i, '')}.pdf`
}

type PdfDocumentApi = {
  create(): Promise<{
    copyPages(source: unknown, indices: number[]): Promise<unknown[]>
    addPage(page: unknown): void
    save(options?: { useObjectStreams?: boolean }): Promise<Uint8Array>
  }>
  load(content: Uint8Array): Promise<{
    getPageIndices(): number[]
  }>
}

function loadPdfDocumentApi(): PdfDocumentApi {
  try {
    return (require('pdf-lib') as { PDFDocument: PdfDocumentApi }).PDFDocument
  } catch {
    throw new Error('pdf-lib dependency is required to merge outbound labels')
  }
}

export async function mergePdfBuffers(
  inputs: Buffer[],
  pdfDocumentApi: PdfDocumentApi = loadPdfDocumentApi(),
): Promise<Buffer> {
  if (!inputs.length) throw new Error('No label PDFs to merge')
  const merged = await pdfDocumentApi.create()
  for (const input of inputs) {
    const source = await pdfDocumentApi.load(input)
    const pages = await merged.copyPages(source, source.getPageIndices())
    pages.forEach((page) => merged.addPage(page))
  }
  return Buffer.from(await merged.save({ useObjectStreams: true }))
}
