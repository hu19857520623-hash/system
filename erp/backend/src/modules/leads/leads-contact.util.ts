export interface LeadContactOwner {
  leadNo?: string | null
  companyName?: string | null
}

const PHONE_SEPARATORS = /[\s\-()+]/g

export const LEAD_CONTACT_TYPES = ['phone', 'wechat', 'qrcode', 'other'] as const
export type LeadContactType = typeof LEAD_CONTACT_TYPES[number]

/** 这些占位词不能当成微信号或手机号去查重。 */
const CONTACT_PLACEHOLDERS = new Set(['二维码', '微信二维码', '无', '未知', '暂无', '同上'])

export function isLeadContactPlaceholder(raw?: string | null): boolean {
  return CONTACT_PLACEHOLDERS.has(String(raw || '').trim().toLowerCase())
}

export function looksLikeLeadPhone(raw?: string | null): boolean {
  const digits = String(raw || '').replace(PHONE_SEPARATORS, '')
  return /^1[3-9]\d{9}$/.test(digits) || /^0\d{10,11}$/.test(digits) || /^\+?27\d{8,10}$/.test(digits)
}

export function inferLeadContactType(input: {
  contactType?: string | null
  contactName?: string | null
  contactPhone?: string | null
}): LeadContactType {
  const explicit = String(input.contactType || '').trim()
  if ((LEAD_CONTACT_TYPES as readonly string[]).includes(explicit)) return explicit as LeadContactType
  const phone = String(input.contactPhone || '').trim()
  const name = String(input.contactName || '').trim()
  if (looksLikeLeadPhone(phone) || looksLikeLeadPhone(name)) return 'phone'
  if (isLeadContactPlaceholder(name) || isLeadContactPlaceholder(phone)) return 'qrcode'
  return 'wechat'
}

export function normalizeLeadCompanyKey(name?: string | null): string {
  return String(name || '').trim().toLowerCase()
}

export interface PreparedLeadContact {
  contactType: LeadContactType
  contactName: string | null
  contactPhone: string | null
}

/** 把登记表单整理成可保存的联系方式。二维码不把「二维码」三个字当唯一键。 */
export function prepareLeadContact(
  input: {
    contactType?: string | null
    contact?: string | null
    contactName?: string | null
    contactPhone?: string | null
    hasQrImage?: boolean
  },
  options?: { allowQrPlaceholder?: boolean },
): PreparedLeadContact {
  const typed = String(input.contact ?? input.contactName ?? '').trim()
  const phoneField = String(input.contactPhone || '').trim()
  const contactType = inferLeadContactType({
    contactType: input.contactType,
    contactName: typed,
    contactPhone: phoneField,
  })

  if (contactType === 'phone') {
    const raw = phoneField || typed
    if (!raw) throw new Error('请填写联系方式')
    if (!looksLikeLeadPhone(raw)) throw new Error('请填写手机号')
    if (raw.length > 30) throw new Error('手机号不能超过 30 字')
    return { contactType, contactName: raw, contactPhone: raw }
  }

  if (contactType === 'wechat' || contactType === 'other') {
    if (!typed) throw new Error('请填写联系方式')
    if (isLeadContactPlaceholder(typed)) {
      throw new Error(contactType === 'wechat' ? '请填写微信号，二维码请改联系方式类型' : '请填写联系方式')
    }
    if (typed.length > 100) throw new Error('联系方式不能超过 100 字')
    return { contactType, contactName: typed, contactPhone: null }
  }

  const note = typed && !isLeadContactPlaceholder(typed) ? typed : ''
  if (note.length > 100) throw new Error('二维码说明不能超过 100 字')
  if (!note && !input.hasQrImage && !options?.allowQrPlaceholder) {
    throw new Error('请上传二维码，或填写昵称、群名等说明')
  }
  return { contactType: 'qrcode', contactName: note || null, contactPhone: null }
}

export function sameCompanyQrMessage(existing?: LeadContactOwner | null, canConfirm = true): string {
  const leadNo = String(existing?.leadNo || '').trim()
  const company = String(existing?.companyName || '').trim()
  const who = leadNo && company ? `${leadNo} / ${company}` : leadNo || company || '已有线索'
  const base = `可能是同一客户（${who}）`
  return canConfirm ? `${base}，确认后仍可保存` : base
}

export function qrImageDuplicateMessage(existing?: LeadContactOwner | null): string {
  const leadNo = String(existing?.leadNo || '').trim()
  const company = String(existing?.companyName || '').trim()
  if (leadNo && company) return `该二维码已登记在（${leadNo} / ${company}）`
  if (leadNo) return `该二维码已登记在（${leadNo}）`
  if (company) return `该二维码已登记在（${company}）`
  return '该二维码已登记'
}

/** 规范化联系方式：电话去分隔符，其它文本转小写后比对。 */
export function normalizeLeadContactKey(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  const compact = trimmed.replace(PHONE_SEPARATORS, '')
  if (/^\d{8,15}$/.test(compact)) return compact
  return trimmed.toLowerCase()
}

export function collectLeadContactKeys(
  contactName?: string | null,
  contactPhone?: string | null,
  contactType?: string | null,
): string[] {
  const type = String(contactType || '').trim()
  if (type === 'qrcode') return []
  if (type === 'phone') {
    const key = normalizeLeadContactKey(contactPhone || contactName)
    return key ? [key] : []
  }
  if (type === 'wechat' || type === 'other') {
    if (isLeadContactPlaceholder(contactName)) return []
    const key = normalizeLeadContactKey(contactName)
    return key ? [key] : []
  }
  const keys = new Set<string>()
  for (const value of [contactName, contactPhone]) {
    if (isLeadContactPlaceholder(value)) continue
    const key = normalizeLeadContactKey(value)
    if (key) keys.add(key)
  }
  return [...keys]
}

export function leadContactDuplicateMessage(existing?: LeadContactOwner | null): string {
  const leadNo = String(existing?.leadNo || '').trim()
  const company = String(existing?.companyName || '').trim()
  if (leadNo && company) return `该联系方式已存在（${leadNo} / ${company}）`
  if (leadNo) return `该联系方式已存在（${leadNo}）`
  if (company) return `该联系方式已存在（${company}）`
  return '该联系方式已存在'
}

export function buildLeadContactIndex(
  rows: Array<{
    contactName?: string | null
    contactPhone?: string | null
    contactType?: string | null
    leadNo?: string | null
    companyName?: string | null
  }>,
): Map<string, LeadContactOwner> {
  const index = new Map<string, LeadContactOwner>()
  for (const row of rows) {
    rememberLeadContacts(index, row.contactName, row.contactPhone, {
      leadNo: row.leadNo,
      companyName: row.companyName,
    }, row.contactType)
  }
  return index
}

export function findIndexedLeadContactConflict(
  index: Map<string, LeadContactOwner>,
  contactName?: string | null,
  contactPhone?: string | null,
  contactType?: string | null,
): LeadContactOwner | null {
  for (const key of collectLeadContactKeys(contactName, contactPhone, contactType)) {
    const owner = index.get(key)
    if (owner) return owner
  }
  return null
}

export function rememberLeadContacts(
  index: Map<string, LeadContactOwner>,
  contactName: string | null | undefined,
  contactPhone: string | null | undefined,
  owner: LeadContactOwner,
  contactType?: string | null,
) {
  for (const key of collectLeadContactKeys(contactName, contactPhone, contactType)) {
    if (!index.has(key)) index.set(key, owner)
  }
}

export function rememberQrLead(
  companies: Map<string, LeadContactOwner>,
  hashes: Map<string, LeadContactOwner>,
  row: {
    contactType?: string | null
    contactName?: string | null
    contactPhone?: string | null
    companyName?: string | null
    leadNo?: string | null
    qrImageHash?: string | null
  },
) {
  const owner = { leadNo: row.leadNo, companyName: row.companyName }
  if (inferLeadContactType(row) === 'qrcode') {
    const companyKey = normalizeLeadCompanyKey(row.companyName)
    if (companyKey && !companies.has(companyKey)) companies.set(companyKey, owner)
  }
  const hash = String(row.qrImageHash || '').trim()
  if (hash && !hashes.has(hash)) hashes.set(hash, owner)
}
