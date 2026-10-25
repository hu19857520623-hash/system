/** 未成交，且当前用户就是这条线索的登记人时，才显示「更正资料」。 */
export function ownLeadCanBeCorrected(
  lead: {
    createdById?: number | string | null
    status?: string | null
    customerId?: number | string | null
    deals?: unknown[] | null
  } | null | undefined,
  userId?: number | null,
): boolean {
  if (!lead || userId == null || lead.createdById == null) return false
  if (Number(lead.createdById) !== Number(userId)) return false
  if (lead.status === 'deal') return false
  if (lead.customerId != null && String(lead.customerId) !== '') return false
  if (Array.isArray(lead.deals) && lead.deals.length > 0) return false
  return true
}
