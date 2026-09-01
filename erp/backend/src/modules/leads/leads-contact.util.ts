export interface LeadContactOwner {
  leadNo?: string | null
  companyName?: string | null
}

const PHONE_SEPARATORS = /[\s\-()+]/g

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
): string[] {
  const keys = new Set<string>()
  for (const value of [contactName, contactPhone]) {
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
    leadNo?: string | null
    companyName?: string | null
  }>,
): Map<string, LeadContactOwner> {
  const index = new Map<string, LeadContactOwner>()
  for (const row of rows) {
    rememberLeadContacts(index, row.contactName, row.contactPhone, {
      leadNo: row.leadNo,
      companyName: row.companyName,
    })
  }
  return index
}

export function findIndexedLeadContactConflict(
  index: Map<string, LeadContactOwner>,
  contactName?: string | null,
  contactPhone?: string | null,
): LeadContactOwner | null {
  for (const key of collectLeadContactKeys(contactName, contactPhone)) {
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
) {
  for (const key of collectLeadContactKeys(contactName, contactPhone)) {
    if (!index.has(key)) index.set(key, owner)
  }
}
