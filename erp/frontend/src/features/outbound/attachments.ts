type Attachment = { fileType?: string; labelRole?: string | null; sku?: string | null; unitIndex?: number | null; downloadable?: boolean }

/** Original uploads remain visible; generated per-SKU crops use the label print panel. */
export function isOutboundSourceAttachment(attachment: Attachment): boolean {
  if (attachment.labelRole === 'sourceDocument') return true
  if (attachment.labelRole === 'unitCrop') return false
  return attachment.fileType !== 'skuLabel' || (attachment.sku == null && attachment.unitIndex == null)
}

export function downloadableOutboundSourceAttachments<T extends Attachment>(attachments: T[]): T[] {
  return attachments.filter(attachment => isOutboundSourceAttachment(attachment) && attachment.downloadable === true)
}
