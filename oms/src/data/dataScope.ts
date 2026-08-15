import type { OmsRole } from '../auth/permissions'
import { getAccountsSnapshot } from '../auth/accountStore'
import { getStoredAuthSession } from '../api/client'
import { CATALOG_CUSTOMER_CODE, CATALOG_CUSTOMER_ID } from './skuCode'

export { CATALOG_CUSTOMER_CODE, CATALOG_CUSTOMER_ID }

export function isSysAdmin(role: OmsRole): boolean {
  return role === 'sys_admin'
}

/** 当前客户身份只来自后端签发的会话，不接受角色到客户的静态映射。 */
export function getCustomerIdForRole(role: OmsRole): string | null {
  if (isSysAdmin(role)) return null
  const user = getStoredAuthSession()?.user
  return user?.role === role ? user.customerId : null
}

export function getCustomerCode(
  customerId?: string,
  accounts: { id: string; code?: string }[] = getAccountsSnapshot(),
): string {
  if (!customerId) return '—'
  const code = accounts.find(a => a.id === customerId)?.code?.trim()
  if (code) return code
  const user = getStoredAuthSession()?.user
  return user?.customerId === customerId && user.customerCode.trim()
    ? user.customerCode.trim()
    : '—'
}

/** 解析提交 ERP 所需的客户 ID 与编码 */
export function resolveErpCustomerContext(options: {
  role: OmsRole
  customerId?: string | null
  adminCustomerFilter?: string
  accounts?: { id: string; code?: string }[]
}): { customerId: string; customerCode: string } | null {
  const accounts = options.accounts ?? getAccountsSnapshot()
  let cid = options.customerId?.trim() || undefined

  if (!cid && isSysAdmin(options.role)) {
    const filter = options.adminCustomerFilter?.trim()
    if (filter && filter !== 'all') cid = filter
  }
  if (!cid && !isSysAdmin(options.role)) {
    cid = getCustomerIdForRole(options.role) ?? undefined
  }
  if (!cid) return null

  const customerCode = getCustomerCode(cid, accounts)
  if (!customerCode || customerCode === '—') return null
  return { customerId: cid, customerCode }
}

/** @deprecated 使用 getCustomerCode */
export function getCustomerName(customerId?: string): string {
  return getCustomerCode(customerId)
}

export interface CustomerScoped {
  customerId?: string
}

/** 出库单：严格按 customerId 隔离，并按角色过滤来源（电商不看货盘分销） */
export function scopeOutboundForRole<T extends CustomerScoped & { source?: string }>(
  items: T[],
  role: OmsRole,
  customerFilter: string = 'all',
  authenticatedCustomerId: string | null = getCustomerIdForRole(role),
): T[] {
  if (isSysAdmin(role)) {
    if (customerFilter !== 'all') {
      return items.filter(i => i.customerId === customerFilter)
    }
    return items
  }
  const cid = authenticatedCustomerId
  if (!cid) return []
  let list = items.filter(i => i.customerId === cid)
  if (role === 'ecommerce') {
    list = list.filter(o => o.source !== 'catalog_dist')
  } else if (role === 'catalog') {
    list = list.filter(o => o.source === 'catalog_dist')
  }
  return list
}

/** 按角色过滤数据：管理员看全部（可选按客户筛选），客户只看自己的 */
export function scopeForRole<T extends CustomerScoped>(
  items: T[],
  role: OmsRole,
  customerFilter: string = 'all',
  authenticatedCustomerId: string | null = getCustomerIdForRole(role),
): T[] {
  if (isSysAdmin(role)) {
    if (customerFilter !== 'all') {
      return items.filter(i => i.customerId === customerFilter)
    }
    return items
  }
  const cid = authenticatedCustomerId
  if (!cid) return []
  return items.filter(i => i.customerId === cid)
}

/** 商品列表：客户侧隐藏未购/catalog 池子中未激活的 SKU；管理员看全部 */
export function scopeProducts<T extends CustomerScoped & {
  inCatalog?: boolean
  customCode?: string
  internalSku: string
  productStatus?: string
}>(
  items: T[],
  role: OmsRole,
  customerFilter: string,
  hasPlatformBarcode: (sku: string) => boolean | string | undefined,
  authenticatedCustomerId: string | null = getCustomerIdForRole(role),
): T[] {
  let list = scopeForRole(items, role, customerFilter, authenticatedCustomerId)
  if (!isSysAdmin(role)) {
    list = list.filter(p =>
      !p.inCatalog
      || p.customCode
      || !!hasPlatformBarcode(p.internalSku)
      || p.productStatus !== 'discarded',
    )
  }
  return list
}
