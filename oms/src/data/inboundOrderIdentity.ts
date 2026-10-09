import type { InboundOrder } from './mockData'

export function mergeInboundOrder(order: InboundOrder, base: InboundOrder[]): InboundOrder[] {
  const idx = base.findIndex(o => o.inboundNo === order.inboundNo || o.id === order.id)
  if (idx < 0) return [order, ...base]
  const next = [...base]
  next[idx] = { ...next[idx], ...order, id: next[idx].id }
  return next
}

export function reconcileInboundIds(base: InboundOrder[], identities: { id: string; inboundNo: string }[]): InboundOrder[] {
  const ids = new Map(identities.map(o => [o.inboundNo, o.id]))
  return base.map(o => ids.has(o.inboundNo) ? { ...o, id: ids.get(o.inboundNo)! } : o)
}
