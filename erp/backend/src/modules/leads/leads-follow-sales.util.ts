/** 从导入备注解析跟进销售：优先「再对接」，否则「对接」。 */
export function parseFollowSalesFromRemark(remark?: string | null): string {
  const text = String(remark || '')
  const again = text.match(/再对接:([^|]+)/)
  if (again?.[1]?.trim()) return again[1].trim()
  const first = text.match(/(?<!再)对接:([^|]+)/)
  if (first?.[1]?.trim()) return first[1].trim()
  return ''
}

export function resolveFollowSales(followSales?: string | null, remark?: string | null): string {
  return String(followSales || '').trim() || parseFollowSalesFromRemark(remark)
}
