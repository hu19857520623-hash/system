import { looksLikeLeadPhone } from '@/api/mappers.ts'

export type LeadContactType = 'phone' | 'wechat' | 'qrcode' | 'other'

export const LEAD_CONTACT_TYPE_OPTIONS: { value: LeadContactType; label: string }[] = [
  { value: 'phone', label: '手机' },
  { value: 'wechat', label: '微信' },
  { value: 'qrcode', label: '二维码' },
  { value: 'other', label: '其他' },
]

const PLACEHOLDERS = new Set(['二维码', '微信二维码', '无', '未知', '暂无', '同上'])

export function isLeadContactPlaceholder(raw?: string | null) {
  return PLACEHOLDERS.has(String(raw || '').trim().toLowerCase())
}

export function inferLeadContactType(row?: {
  contactType?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contact?: string | null
} | null): LeadContactType {
  const explicit = String(row?.contactType || '').trim()
  if (explicit === 'phone' || explicit === 'wechat' || explicit === 'qrcode' || explicit === 'other') return explicit
  const phone = String(row?.contactPhone || '').trim()
  const name = String(row?.contactName || row?.contact || '').trim()
  if (looksLikeLeadPhone(phone) || looksLikeLeadPhone(name)) return 'phone'
  if (isLeadContactPlaceholder(name) || isLeadContactPlaceholder(phone)) return 'qrcode'
  return 'wechat'
}

/** 表单里要回填的原文。二维码占位词不放进说明框。 */
export function leadContactInputValue(row?: {
  contactType?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contact?: string | null
} | null): string {
  const type = inferLeadContactType(row)
  if (type === 'phone') return String(row?.contactPhone || row?.contactName || row?.contact || '').trim()
  const name = String(row?.contactName || row?.contact || '').trim()
  if (type === 'qrcode' && isLeadContactPlaceholder(name)) return ''
  return name
}

export function contactFieldPlaceholder(type: LeadContactType): string {
  if (type === 'phone') return '手机号，不可与已有线索重复'
  if (type === 'wechat') return '微信号，不可与已有线索重复'
  if (type === 'qrcode') return '昵称或群名，选填'
  return '邮箱或其他账号，不可与已有线索重复'
}

export function isSameCompanyQrPrompt(message?: string | null) {
  const text = String(message || '')
  return text.includes('可能是同一客户') && text.includes('确认后仍可保存')
}
