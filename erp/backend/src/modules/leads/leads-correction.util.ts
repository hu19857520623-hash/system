import {
  inferLeadContactType,
  isLeadContactPlaceholder,
  prepareLeadContact,
  type LeadContactType,
} from './leads-contact.util'
import { stripLeadRemarkImportPrefix } from './leads-remark.util'

export const LEAD_SOURCE_OPTIONS = [
  'Takealot', '官网', '展会', '推荐', '小红书', '抖音', '视频号', '公众号', '其他',
] as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface LeadCorrectionSnapshot {
  companyName?: string | null
  contactType?: string | null
  contactName?: string | null
  contactPhone?: string | null
  email?: string | null
  source?: string | null
  remark?: string | null
  qrImageHash?: string | null
}

export interface LeadCorrectionChange {
  field: 'companyName' | 'contact' | 'qrImage' | 'email' | 'source' | 'remark'
  label: string
  before: string
  after: string
}

export interface LeadCorrectionInput {
  companyName?: unknown
  contactType?: unknown
  contact?: unknown
  email?: unknown
  source?: unknown
  remark?: unknown
  hasQrImage?: boolean
}

export interface PlannedLeadCorrection {
  companyName: string
  contactType: LeadContactType | null
  contactName: string | null
  contactPhone: string | null
  email: string | null
  source: string | null
  remark: string | null
  changes: LeadCorrectionChange[]
}

/** 与线索池展示一致。二维码只展示说明，不把占位词再拼一遍。 */
export function leadContactDisplay(row: LeadCorrectionSnapshot): string {
  const type = inferLeadContactType(row)
  if (type === 'qrcode') {
    const note = String(row.contactName || '').trim()
    return !note || isLeadContactPlaceholder(note) ? '二维码' : `二维码 · ${note}`
  }
  const company = String(row.companyName || '').trim()
  const uniq: string[] = []
  for (const raw of [row.contactName, row.contactPhone]) {
    const value = String(raw || '').trim()
    if (!value || uniq.includes(value)) continue
    uniq.push(value)
  }
  if (uniq.length > 1) {
    const withoutCompany = uniq.filter((value) => value !== company)
    if (withoutCompany.length) return withoutCompany.join(' / ')
  }
  return uniq.join(' / ')
}

function visibleRemark(remark?: string | null): string {
  return stripLeadRemarkImportPrefix(remark).trim()
}

/** 只规划客户名称、联系方式、邮箱、来源、备注。联系方式展示没变时保留原字段。 */
export function planLeadCorrection(
  existing: LeadCorrectionSnapshot,
  input: LeadCorrectionInput,
): PlannedLeadCorrection {
  const companyName = String(input.companyName ?? '').trim()
  if (!companyName) throw new Error('请填写客户名称')
  if (companyName.length > 200) throw new Error('客户名称不能超过 200 字')

  const existingContact = leadContactDisplay(existing)
  const contactText = input.contact == null ? existing.contactName : String(input.contact)
  const requestedType = input.contactType == null ? undefined : String(input.contactType)
  const nextType = inferLeadContactType({ contactType: requestedType, contactName: contactText })
  const existingPlaceholderQr = inferLeadContactType(existing) === 'qrcode'
    && isLeadContactPlaceholder(existing.contactName)
  const prepared = prepareLeadContact({
    contactType: requestedType,
    contact: contactText,
    hasQrImage: input.hasQrImage === true || (nextType === 'qrcode' && Boolean(existing.qrImageHash)),
  }, {
    allowQrPlaceholder: existingPlaceholderQr && !String(contactText || '').trim() && input.hasQrImage !== true,
  })
  const preparedContact = leadContactDisplay({
    companyName,
    contactType: prepared.contactType,
    contactName: prepared.contactName,
    contactPhone: prepared.contactPhone,
  })
  const contactUnchanged = preparedContact === existingContact
    && prepared.contactType === inferLeadContactType(existing)
  const contactType: LeadContactType | null = contactUnchanged
    ? ((existing.contactType as LeadContactType | null | undefined) ?? null)
    : prepared.contactType
  const contactName = contactUnchanged ? (existing.contactName ?? null) : prepared.contactName
  const contactPhone = contactUnchanged ? (existing.contactPhone ?? null) : prepared.contactPhone

  const emailRaw = String(input.email ?? '').trim()
  if (emailRaw.length > 100) throw new Error('邮箱不能超过 100 字')
  if (emailRaw && !EMAIL_PATTERN.test(emailRaw)) throw new Error('邮箱格式不正确')
  const email = emailRaw || null

  const sourceRaw = String(input.source ?? '').trim()
  if (sourceRaw.length > 30) throw new Error('来源渠道无效')
  const existingSource = String(existing.source || '').trim()
  if (sourceRaw && sourceRaw !== existingSource && !LEAD_SOURCE_OPTIONS.includes(sourceRaw as typeof LEAD_SOURCE_OPTIONS[number])) {
    throw new Error('来源渠道无效')
  }
  const source = sourceRaw || null

  const remarkRaw = String(input.remark ?? '').trim()
  if (remarkRaw.length > 2000) throw new Error('备注不能超过 2000 字')
  const previousRemark = visibleRemark(existing.remark)
  const remark = remarkRaw === previousRemark ? (existing.remark ?? null) : (remarkRaw || null)

  const nextContact = leadContactDisplay({ companyName, contactName, contactPhone })
  const changes: LeadCorrectionChange[] = []
  const push = (field: LeadCorrectionChange['field'], label: string, before: string, after: string) => {
    if (before !== after) changes.push({ field, label, before, after })
  }
  push('companyName', '客户名称', String(existing.companyName || '').trim(), companyName)
  push('contact', '联系方式', existingContact, nextContact)
  push('email', '邮箱', String(existing.email || '').trim(), email || '')
  push('source', '来源', existingSource, source || '')
  push('remark', '备注', previousRemark, visibleRemark(remark))

  return { companyName, contactType, contactName, contactPhone, email, source, remark, changes }
}
