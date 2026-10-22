export const INBOUND_TRANSIT_STATUSES = ['pending_receipt', 'pending_push', 'push_failed', 'pushed', 'arrived', 'receiving', 'exception']
export const INBOUND_PIPELINE_STATUSES = [...INBOUND_TRANSIT_STATUSES, 'pending_putaway']

/** 两端库存使用同一组已提交入库单及同一数量口径；草稿、作废和完成单不计入途存。 */
export function buildInboundPipelineQtyMap(orders: Array<{
  warehouseCode: string; status: string
  items: Array<{ sku: string; expectedQty: number; actualQty?: number | null; putawayQty?: number | null }>
}>) {
  const result = new Map<string, { inTransit: number; pendingPutaway: number }>()
  for (const order of orders) {
    if (!INBOUND_PIPELINE_STATUSES.includes(order.status)) continue
    for (const item of order.items) {
      const key = `${item.sku}::${order.warehouseCode}`
      const value = result.get(key) || { inTransit: 0, pendingPutaway: 0 }
      if (INBOUND_TRANSIT_STATUSES.includes(order.status)) {
        const remaining = Math.max(0, item.expectedQty - (item.actualQty ?? 0))
        value.inTransit += remaining > 0 ? remaining : item.expectedQty
      } else {
        value.pendingPutaway += Math.max(0, (item.actualQty ?? item.expectedQty) - (item.putawayQty ?? 0))
      }
      result.set(key, value)
    }
  }
  return result
}
