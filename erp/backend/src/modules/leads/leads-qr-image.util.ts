import { createHash } from 'crypto'
import * as path from 'path'

const QR_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const QR_MAX_BYTES = 5 * 1024 * 1024

export interface DecodedLeadQrImage {
  hash: string
  ext: string
  bytes: Buffer
}

/** 校验并摘要二维码图片。相同文件得到相同哈希。 */
export function decodeLeadQrImage(file: { fileName?: string | null; contentBase64?: string | null }): DecodedLeadQrImage {
  const payload = String(file?.contentBase64 || '')
  const raw = payload.includes(',') ? payload.slice(payload.indexOf(',') + 1) : payload
  const bytes = Buffer.from(raw, 'base64')
  if (!bytes.length) throw new Error('二维码图片内容为空')
  if (bytes.length > QR_MAX_BYTES) throw new Error('二维码图片不能超过 5MB')
  const ext = path.extname(String(file?.fileName || '')).toLowerCase()
  if (!QR_EXTS.has(ext)) throw new Error('二维码图片只支持 jpg、png、webp、gif')
  return { hash: createHash('sha256').update(bytes).digest('hex'), ext, bytes }
}
