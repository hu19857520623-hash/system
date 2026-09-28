import { BadRequestException } from '@nestjs/common'
import * as path from 'path'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function validateOmsProductImage(data: { fileName?: string; contentBase64?: string }) {
  const fileName = String(data.fileName || '').trim()
  const encoded = String(data.contentBase64 || '')
  if (!fileName || !encoded) throw new BadRequestException('请选择要上传的商品图片')
  const ext = path.extname(fileName).toLowerCase()
  const payload = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || payload.length % 4 !== 0) {
    throw new BadRequestException('图片内容无效')
  }
  const bytes = Buffer.from(payload, 'base64')
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException('商品图片大小须在 5MB 以内')
  }
  const isJpeg = (ext === '.jpg' || ext === '.jpeg') && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  const isPng = ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isGif = ext === '.gif' && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  const isWebp = ext === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!isJpeg && !isPng && !isGif && !isWebp) {
    throw new BadRequestException('仅支持内容与扩展名一致的 JPG、PNG、GIF 或 WebP 图片')
  }
  return { fileName, contentBase64: payload }
}
