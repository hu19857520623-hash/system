export class OutboundAttachmentContentError extends Error {}

/** Never drop a named upload from an outbound request when its bytes are missing. */
export function requireOutboundAttachmentContent(
  attachment: { fileName?: string; contentBase64?: string; url?: string },
  index: number,
): string {
  const name = attachment.fileName?.trim()
  if (!name) throw new OutboundAttachmentContentError(`附件 ${index + 1} 缺少文件名，请重新上传`)
  let content = attachment.contentBase64?.trim() || ''
  if (!content && /^data:[^,]*;base64,/i.test(attachment.url || '')) {
    content = attachment.url!.slice(attachment.url!.indexOf(',') + 1)
  }
  if (/^data:[^,]*;base64,/i.test(content)) content = content.slice(content.indexOf(',') + 1)
  content = content.replace(/\s/g, '')
  if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content) || Buffer.from(content, 'base64').length === 0) {
    throw new OutboundAttachmentContentError(`附件「${name}」缺少有效文件内容，请重新上传；本次出库尚未同步 ERP`)
  }
  return content
}
