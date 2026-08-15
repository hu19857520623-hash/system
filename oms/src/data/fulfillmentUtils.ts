import type { Order, OutboundOrder, ShipmentSource, LogisticsRecord } from './mockData'
import {
  platformDisplayLabel,
  SHIPMENT_SOURCE_LABELS,
  statusLabels,
} from './mockData'

export interface FulfillmentRow {
  id: string
  /** 系统自动生成，每条出库单必有 */
  outboundNo: string
  /** 客户填写的参考号 */
  refNo: string | null
  /** 海外仓回传的运单号 */
  trackingNo: string | null
  shippingMethod: string | null
  source: ShipmentSource | null
  platform: string
  store: string
  warehouse: string
  statusKey: string
  statusLabel: string
  amount: number | null
  createdAt: string
  customerId?: string
  order?: Order
  outbound?: OutboundOrder
  logistics?: LogisticsRecord
}

function platformForRow(outbound: OutboundOrder, order: Order | undefined): string {
  if (order) return platformDisplayLabel(order.platform)
  if (outbound.source === 'platform_order') return 'Takealot'
  if (outbound.source === 'catalog_dist') return '—'
  return '其他'
}

function storeForRow(order: Order | undefined): string {
  if (order?.store && order.store !== '—') return order.store
  return '—'
}

function statusForRow(outbound: OutboundOrder, order: Order | undefined): { key: string; label: string } {
  if (order && ['pending_ship', 'pending_review', 'pending_payment'].includes(order.status)) {
    return { key: order.status, label: statusLabels[order.status] ?? order.status }
  }
  if (order && !['pending_ship', 'pending_review', 'pending_payment'].includes(order.status)) {
    const outboundActive = ['pending', 'locked', 'picking'].includes(outbound.status)
    if (outboundActive) {
      return { key: outbound.status, label: statusLabels[outbound.status] ?? outbound.status }
    }
    return { key: order.status, label: statusLabels[order.status] ?? order.status }
  }
  return { key: outbound.status, label: statusLabels[outbound.status] ?? outbound.status }
}

function warehouseTracking(
  outboundNo: string,
  logistics: LogisticsRecord[],
  fallback?: string,
): string | null {
  const fromLogistics = logistics.find(l => l.outboundNo === outboundNo)
  if (fromLogistics?.trackingNo && fromLogistics.trackingNo !== '—') {
    return fromLogistics.trackingNo
  }
  return fallback ?? null
}

/** 平台订单同步后系统自动创建出库单号（尚未预约发货的订单） */
function systemOutboundNoForOrder(order: Order): string {
  const date = order.createdAt.slice(0, 10).replace(/-/g, '')
  return `OUT-${date}${String(order.id).padStart(3, '0')}`
}

export function buildFulfillmentRows(
  orders: Order[],
  outboundOrders: OutboundOrder[],
  logistics: LogisticsRecord[] = [],
): FulfillmentRow[] {
  const orderByNo = new Map(orders.map(o => [o.orderNo, o]))
  const linkedOrderNos = new Set<string>()

  const logisticsByOutbound = new Map(logistics.map(l => [l.outboundNo, l]))

  const fromOutbound: FulfillmentRow[] = outboundOrders.map(ob => {
    const order = ob.orderNo ? orderByNo.get(ob.orderNo) : undefined
    if (order) linkedOrderNos.add(order.orderNo)
    const log = logisticsByOutbound.get(ob.outboundNo)
    const { key, label } = statusForRow(ob, order)
    return {
      id: `ob-${ob.id}`,
      outboundNo: ob.outboundNo,
      refNo: ob.refNo?.trim() || null,
      trackingNo: warehouseTracking(ob.outboundNo, logistics, ob.trackingNo),
      shippingMethod: ob.shippingMethod ?? order?.logistics ?? log?.carrier ?? null,
      source: ob.source,
      platform: platformForRow(ob, order),
      store: storeForRow(order),
      warehouse: ob.warehouse,
      statusKey: key,
      statusLabel: label,
      amount: order?.amount ?? null,
      createdAt: ob.createdAt,
      customerId: ob.customerId ?? order?.customerId,
      order,
      outbound: ob,
      logistics: log,
    }
  })

  /** 已同步平台订单、系统已分配出库单号但尚未创建出库单记录 */
  const fromPendingOrders: FulfillmentRow[] = orders
    .filter(o => !linkedOrderNos.has(o.orderNo))
    .map(o => ({
      id: `ord-${o.id}`,
      outboundNo: systemOutboundNoForOrder(o),
      refNo: null,
      trackingNo: null,
      shippingMethod: o.logistics || null,
      source: (o.platform === 'Manual' ? 'manual' : 'platform_order') as ShipmentSource,
      platform: platformDisplayLabel(o.platform),
      store: o.store,
      warehouse: o.warehouse,
      statusKey: o.status,
      statusLabel: statusLabels[o.status] ?? o.status,
      amount: o.amount,
      createdAt: o.createdAt,
      customerId: o.customerId,
      order: o,
    }))

  return [...fromOutbound, ...fromPendingOrders].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  )
}

export interface FulfillmentFilters {
  dateFrom: string
  dateTo: string
  orderNo: string
  orderNoMode: 'exact' | 'fuzzy'
  sku: string
  skuMode: 'exact' | 'fuzzy'
  platform: string
  store: string
  warehouse: string
  status: string
  logistics: string
}

export const defaultFulfillmentFilters: FulfillmentFilters = {
  dateFrom: '',
  dateTo: '',
  orderNo: '',
  orderNoMode: 'fuzzy',
  sku: '',
  skuMode: 'fuzzy',
  platform: 'all',
  store: 'all',
  warehouse: 'all',
  status: 'all',
  logistics: 'all',
}

function matchText(value: string, query: string, mode: 'exact' | 'fuzzy'): boolean {
  if (!query) return true
  const v = value.toLowerCase()
  const q = query.toLowerCase()
  return mode === 'exact' ? v === q : v.includes(q)
}

function matchPlatform(row: FulfillmentRow, filter: string): boolean {
  if (filter === 'all') return true
  const raw = row.order?.platform ?? (row.platform === 'Takealot' ? 'Takealot' : 'Manual')
  if (filter === 'Takealot') return raw === 'Takealot'
  if (filter === '其他') return raw !== 'Takealot'
  return true
}

export function applyFulfillmentFilters(rows: FulfillmentRow[], f: FulfillmentFilters): FulfillmentRow[] {
  return rows.filter(r => {
    if (f.platform !== 'all' && !matchPlatform(r, f.platform)) return false
    if (f.store !== 'all' && r.store !== f.store) return false
    if (f.warehouse !== 'all' && r.warehouse !== f.warehouse) return false
    if (f.status !== 'all' && r.statusKey !== f.status) return false
    if (f.logistics !== 'all' && (r.shippingMethod ?? '') !== f.logistics) return false
    const dateKey = r.createdAt.slice(0, 10)
    if (f.dateFrom && dateKey < f.dateFrom) return false
    if (f.dateTo && dateKey > f.dateTo) return false
    const noHaystack = `${r.outboundNo} ${r.refNo ?? ''} ${r.trackingNo ?? ''} ${r.order?.orderNo ?? ''}`
    if (!matchText(noHaystack, f.orderNo, f.orderNoMode)) return false
    if (f.sku && !r.order?.items.some(i => matchText(i.sku, f.sku, f.skuMode))) return false
    return true
  })
}

export function filterFulfillmentRows(
  rows: FulfillmentRow[],
  tab: string,
  filters: FulfillmentFilters,
): FulfillmentRow[] {
  let list = applyFulfillmentFilters(rows, filters)
  list = list.filter(r => {
    const matchTab = tab === 'all'
      || (tab === 'active' && ['pending', 'locked', 'picking', 'pending_ship', 'processing'].includes(r.statusKey))
      || (tab === 'in_transit' && r.logistics?.status === 'in_transit')
      || (tab === 'delivered' && r.logistics?.status === 'delivered')
      || (tab === 'logistics_exception' && r.logistics?.status === 'exception')
      || (tab === 'pod_pending' && r.logistics?.podStatus === 'pending')
      || r.source === tab
    return matchTab
  })
  return list
}

export { SHIPMENT_SOURCE_LABELS }
