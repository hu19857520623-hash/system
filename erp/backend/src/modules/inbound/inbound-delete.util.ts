const RECEIVING_STARTED_STATUSES = new Set([
  'receiving',
  'pending_putaway',
  'completed',
  'confirmed',
  'exception',
  'cancelled',
])

export function inboundReceivingStarted(order: {
  status?: string | null
  receivedAt?: Date | string | null
  items?: Array<{ actualQty?: number | null; putawayQty?: number | null }>
  cartons?: Array<{ status?: string | null }>
}): boolean {
  const status = String(order.status || '')
  if (RECEIVING_STARTED_STATUSES.has(status)) return true
  if (order.receivedAt) return true
  if ((order.items || []).some((item) => Number(item.actualQty ?? 0) > 0 || Number(item.putawayQty ?? 0) > 0)) {
    return true
  }
  if ((order.cartons || []).some((carton) => carton.status === 'received')) return true
  return false
}
