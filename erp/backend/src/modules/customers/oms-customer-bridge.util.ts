import { PrismaService } from '../../common/prisma/prisma.service'

export type OmsCustomerRow = {
  omsId: string
  code: string
  name: string
  companyName: string
  type: string
  contact: string
  contactPhone: string
  email: string
  status: string
  permissions: string[]
  warehouse: string
  createdAt: string
  lastLoginAt: string
  priceTemplateId: string | null
  creditBalance: number | null
  monthlySpent: number | null
  pendingBill: number | null
  budgetUsed: number | null
  portalLoginEmail: string | null
  portalStatus: string | null
  mustChangePassword: boolean | null
  portalLastLoginAt: string | null
}

function parsePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseOmsDate(raw: string | null | undefined): Date | null {
  const s = String(raw || '').trim()
  if (!s) return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

export function omsStatusToErp(status: string): number {
  return String(status || '').trim().toLowerCase() === 'active' ? 1 : 0
}

/** OMS-only 客户使用负数 id，避免与 ERP 自增 id 冲突 */
export function omsOnlyCustomerId(omsId: string): number {
  const n = Number(omsId)
  if (Number.isFinite(n) && n > 0) return -n
  let hash = 0
  for (let i = 0; i < omsId.length; i++) hash = (hash * 31 + omsId.charCodeAt(i)) | 0
  return hash > 0 ? -hash : hash
}

export function isOmsOnlyCustomerId(id: number): boolean {
  return id < 0
}

export async function fetchOmsCustomerRows(prisma: PrismaService): Promise<OmsCustomerRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      omsId: string
      code: string
      name: string
      companyName: string | null
      type: string
      contact: string
      contactPhone: string | null
      email: string
      status: string
      permissions: string
      warehouse: string
      createdAt: string
      lastLoginAt: string
      priceTemplateId: string | null
      creditBalance: number | null
      monthlySpent: number | null
      pendingBill: number | null
      budgetUsed: number | null
      portalLoginEmail: string | null
      portalStatus: string | null
      mustChangePassword: boolean | number | null
      portalLastLoginAt: string | null
    }>
  >(
    `SELECT
      c.id AS omsId,
      c.code,
      c.name,
      c.companyName,
      c.type,
      c.contact,
      c.contactPhone,
      c.email,
      c.status,
      c.permissions,
      c.warehouse,
      c.createdAt,
      c.lastLoginAt,
      c.priceTemplateId,
      b.creditBalance,
      b.monthlySpent,
      b.pendingBill,
      b.budgetUsed,
      u.loginEmail AS portalLoginEmail,
      u.status AS portalStatus,
      u.mustChangePassword,
      u.lastLoginAt AS portalLastLoginAt
    FROM oms_CustomerAccount c
    LEFT JOIN oms_BillingAccount b ON b.customerId = c.id
    LEFT JOIN oms_PortalUser u ON u.customerId = c.id
    ORDER BY c.createdAt DESC`,
  )

  return rows.map((r) => ({
    omsId: String(r.omsId),
    code: String(r.code),
    name: String(r.name),
    companyName: String(r.companyName || ''),
    type: String(r.type),
    contact: String(r.contact),
    contactPhone: String(r.contactPhone || ''),
    email: String(r.email),
    status: String(r.status),
    permissions: parsePermissions(r.permissions),
    warehouse: String(r.warehouse),
    createdAt: String(r.createdAt),
    lastLoginAt: String(r.lastLoginAt),
    priceTemplateId: r.priceTemplateId ? String(r.priceTemplateId) : null,
    creditBalance: r.creditBalance != null ? Number(r.creditBalance) : null,
    monthlySpent: r.monthlySpent != null ? Number(r.monthlySpent) : null,
    pendingBill: r.pendingBill != null ? Number(r.pendingBill) : null,
    budgetUsed: r.budgetUsed != null ? Number(r.budgetUsed) : null,
    portalLoginEmail: r.portalLoginEmail ? String(r.portalLoginEmail) : null,
    portalStatus: r.portalStatus ? String(r.portalStatus) : null,
    mustChangePassword:
      r.mustChangePassword == null ? null : Boolean(r.mustChangePassword),
    portalLastLoginAt: r.portalLastLoginAt ? String(r.portalLastLoginAt) : null,
  }))
}

export function toOmsPayload(row: OmsCustomerRow) {
  return {
    omsId: row.omsId,
    type: row.type,
    warehouse: row.warehouse,
    permissions: row.permissions,
    lastLoginAt: row.portalLastLoginAt || row.lastLoginAt || null,
    priceTemplateId: row.priceTemplateId,
    creditBalance: row.creditBalance,
    monthlySpent: row.monthlySpent,
    pendingBill: row.pendingBill,
    budgetUsed: row.budgetUsed,
    omsStatus: row.status,
    portalReady: Boolean(row.portalLoginEmail),
    portalLoginEmail: row.portalLoginEmail,
    portalStatus: row.portalStatus,
    mustChangePassword: row.mustChangePassword,
  }
}

export function buildOmsOnlyListItem(row: OmsCustomerRow) {
  const createdAt = parseOmsDate(row.createdAt) || new Date(0)
  const updatedAt = parseOmsDate(row.lastLoginAt) || createdAt
  return {
    id: omsOnlyCustomerId(row.omsId),
    customerCode: row.code,
    customerName: row.name,
    companyName: row.companyName || null,
    contactEmail: row.email || null,
    contactName: row.contact || null,
    contactPhone: row.contactPhone || null,
    balance: row.creditBalance ?? 0,
    status: omsStatusToErp(row.status),
    createdAt,
    updatedAt,
    dataSource: 'oms' as const,
    readOnly: true,
    oms: toOmsPayload(row),
    totalRecharge: 0,
    lastRechargeAt: null as Date | null,
  }
}

export function enrichErpWithOms(
  erp: {
    id: bigint
    customerCode: string
    customerName: string
    companyName: string | null
    contactEmail: string | null
    contactName: string | null
    contactPhone: string | null
    balance: unknown
    status: number
    createdAt: Date
    updatedAt: Date
  },
  oms: OmsCustomerRow | undefined,
  recharge?: { total: number; lastAt: Date | null },
) {
  const base = {
    ...erp,
    id: Number(erp.id),
    balance: Number(erp.balance),
    totalRecharge: recharge?.total ?? 0,
    lastRechargeAt: recharge?.lastAt ?? null,
    dataSource: oms ? ('both' as const) : ('erp' as const),
    readOnly: false,
    oms: oms ? toOmsPayload(oms) : null,
  }
  if (!oms) return base
  return {
    ...base,
    contactEmail: base.contactEmail || oms.email || null,
    contactName: base.contactName || oms.contact || null,
  }
}

export function matchesCustomerKeyword(item: {
  customerCode: string
  customerName: string
  companyName?: string | null
  contactEmail?: string | null
  contactName?: string | null
  contactPhone?: string | null
  oms?: ReturnType<typeof toOmsPayload> | null
}, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  const parts = [
    item.customerCode,
    item.customerName,
    item.companyName,
    item.contactEmail,
    item.contactName,
    item.contactPhone,
    item.oms?.type,
    item.oms?.warehouse,
    item.oms?.omsId,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
  return parts.some((p) => p.includes(kw))
}
