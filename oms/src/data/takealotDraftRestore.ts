import type { FileAttachment } from './mockData'
import { TAKEALOT_ATTACHMENT_KINDS } from './mockData'
import {
  mergeTakealotParsed, parseTakealotDocumentText, parseTakealotFilename,
  type TakealotParsedDoc,
} from './takealotDocParser'
import type { TakealotLabelPdfResult } from './takealotLabelPdf'

type Readers = {
  extractText: (file: File) => Promise<string>
  parseLabels: (file: File) => Promise<TakealotLabelPdfResult>
}

const docKinds: Record<string, string> = {
  outerLabel: '外箱标', skuLabel: 'SKU 标签', deliveryList: '发货清单', appointment: '预约单',
}

/** Rebuild transient validation from the saved source files, never from a cached "passed" flag. */
export async function restoreTakealotDraftAttachments(attachments: FileAttachment[], readers: Readers) {
  const parts = new Map<string, Partial<TakealotParsedDoc>[]>()
  const labelResults: Record<string, TakealotLabelPdfResult> = {}
  const errors: string[] = []
  const crops: FileAttachment[] = []
  for (const attachment of attachments) {
    const fileType = attachment.fileType || attachment.kind
    const docKind = docKinds[fileType]
    if (!docKind || attachment.labelRole === 'unitCrop') continue
    try {
      const response = await fetch(attachment.url)
      if (!response.ok) throw new Error('已保存的附件无法读取')
      const blob = await response.blob()
      const file = new File([blob], attachment.fileName, { type: blob.type })
      const isPdf = /\.pdf$/i.test(file.name)
      let text = ''
      try {
        text = isPdf ? await readers.extractText(file) : await file.text()
      } catch (error) {
        // Unit labels can be scanned images: the label parser remains authoritative.
        if (fileType !== TAKEALOT_ATTACHMENT_KINDS.skuLabel) throw error
      }
      const fileParts: Partial<TakealotParsedDoc>[] = [
        parseTakealotFilename(file.name), parseTakealotDocumentText(text, docKind),
      ]
      if (isPdf && fileType !== TAKEALOT_ATTACHMENT_KINDS.skuLabel && !text.trim()) {
        errors.push(`${file.name}：未提取到文字，请重新上传可识别的 PDF`)
      }
      if (isPdf && fileType === TAKEALOT_ATTACHMENT_KINDS.skuLabel) {
        const result = await readers.parseLabels(file)
        labelResults[file.name] = result
        const counts = new Map<string, { qty: number; title?: string }>()
        for (const crop of result.crops) {
          const current = counts.get(crop.barcode)
          counts.set(crop.barcode, { qty: (current?.qty || 0) + 1, title: current?.title || crop.title })
          crops.push({ kind: fileType, fileType, fileName: crop.fileName, url: crop.dataUrl,
            uploadedAt: attachment.uploadedAt, platformBarcode: crop.barcode, unitIndex: crop.unitIndex,
            sourcePage: crop.page, sourceRow: crop.row + 1, sourceColumn: crop.column + 1,
            labelRole: 'unitCrop', localStorageRef: file.name })
        }
        fileParts.push({ sources: [`labels:${file.name}`], lineItems: [...counts].map(([barcode, value]) => ({
          sku: barcode, barcode, qty: value.qty, observedLabelCount: value.qty, productTitle: value.title,
        })) })
      }
      parts.set(`${fileType}:${file.name}`, fileParts)
    } catch (error) {
      errors.push(`${attachment.fileName}：草稿附件校验失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const parsed = parts.size ? mergeTakealotParsed(...[...parts.values()].flat()) : null
  const nextAttachments = attachments
    .filter(a => a.labelRole !== 'unitCrop' || !a.localStorageRef || !(a.localStorageRef in labelResults))
    .map(a => docKinds[a.fileType || a.kind] && a.labelRole !== 'unitCrop'
      ? { ...a, fileType: a.fileType || a.kind, labelRole: 'sourceDocument' } : a)
  return { parts, parsed, labelResults, errors, attachments: [...nextAttachments, ...crops] }
}
