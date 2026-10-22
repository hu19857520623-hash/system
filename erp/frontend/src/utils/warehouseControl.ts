export type WarehouseControlKind = 'resolve-exception' | 'reopen-count' | 'close-zero' | 'reduce-qc' | 'reduce-carton' | 'reduce-putaway'
export const warehouseControlLabels: Record<WarehouseControlKind, string> = { 'resolve-exception': '放行上架', 'reopen-count': '更正清点', 'close-zero': '零收货结束', 'reduce-qc': '减少实收件数', 'reduce-carton': '减少实收箱数', 'reduce-putaway': '撤回最近上架' }
export const warehouseControlDescriptions: Record<WarehouseControlKind, string> = {
  'resolve-exception': '确认本单清点异常的处理原因，保存后继续测量与上架。', 'reopen-count': '退回收货中，保留原实收数量供重新核对；已有上架库存须先处理。', 'close-zero': '全部商品已明确实收为0时结束单据，本次不增加库存。',
  'reduce-qc': '更正多计的实收件数，保留应收数量与操作原因。', 'reduce-carton': '减少已确认的实收箱数；保存后需重新核对实际箱数和差异原因。', 'reduce-putaway': '撤回本SKU最近一笔尚未完结的上架，同时扣减本批库位与仓库库存；已使用或锁定库存请交主管核对。',
}
export function warehouseControlOptions(order: any, can: (permission: string) => boolean): WarehouseControlKind[] {
  if (!order || order.readOnly || String(order.id).startsWith('oms-') || !(order.items || []).length) return []
  const items = order.items, noStock = items.every((item: any) => Number(item.putawayQty || 0) === 0) && !(order.putawayItems || []).some((row: any) => Number(row.qty) > 0)
  const zero = items.every((item: any) => item.actualQty != null && Number(item.actualQty) === 0)
  const choices: WarehouseControlKind[] = []
  if (can('inbound.qc') && noStock && (['pending_putaway', 'exception'].includes(order.status) || (order.status === 'completed' && zero))) choices.push('reopen-count')
  if ((can('inbound.confirm_diff') || can('inbound.handle_exception')) && noStock && zero && ['pending_putaway', 'exception'].includes(order.status)) choices.push('close-zero')
  if (order.status === 'exception' && ['inbound.qc', 'inbound.putaway', 'inbound.confirm_diff', 'inbound.handle_exception'].some(can)) choices.push('resolve-exception')
  if (['arrived', 'receiving'].includes(order.status)) {
    if (can('inbound.receive') && Number(order.receivedCartonCount || 0) > 0) choices.push('reduce-carton')
    if (can('inbound.qc') && items.some((item: any) => Number(item.actualQty || 0) > Number(item.putawayQty || 0))) choices.push('reduce-qc')
  }
  if (order.status === 'pending_putaway' && can('inbound.putaway') && items.some((item: any) => Number(item.putawayQty || 0) > 0)) choices.push('reduce-putaway')
  return choices
}
export function warehouseControlCurrent(order: any, kind: WarehouseControlKind, itemId?: number | null) {
  if (kind === 'reduce-carton') return Math.max(Number(order?.receivedCartonCount || 0), (order?.cartons || []).filter((box: any) => box.status === 'received').length)
  const item = order?.items?.find((item: any) => Number(item.id) === Number(itemId))
  return kind === 'reduce-qc' ? Number(item?.actualQty || 0) : kind === 'reduce-putaway' ? Number(item?.putawayQty || 0) : 0
}
export function warehouseControlLimit(order: any, kind: WarehouseControlKind, itemId?: number | null) {
  if (kind !== 'reduce-putaway') return warehouseControlCurrent(order, kind, itemId)
  const last = [...(order?.putawayItems || [])].filter((row: any) => Number(row.inboundItemId) === Number(itemId) && Number(row.qty) > 0).sort((a: any, b: any) => Number(b.id) - Number(a.id))[0]
  return Math.min(warehouseControlCurrent(order, kind, itemId), Number(last?.qty || 0))
}
