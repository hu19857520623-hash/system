import { fetchSkuOutboundLogs } from '../api/erp'
import { statusLabels, type OutboundOrder } from './mockData'

export type SkuOutboundLogRow = {
  outboundNo: string
  qty: number
  status: string
  statusLabel: string
  refNo?: string
  destination?: string
  warehouse?: string
  createdAt: string
  shippedAt?: string
  trackingNo?: string
  appointmentDate?: string
}

function formatDate(val: unknown): string {
  if (!val) return '—'
  const s = String(val)
  return s.length >= 10 ? s.slice(0, 10) : s
}

export function findLocalSkuOutbounds(orders: OutboundOrder[], sku: string): SkuOutboundLogRow[] {
  const rows: SkuOutboundLogRow[] = []
  for (const o of orders) {
    const lines = o.lineItems?.filter(l => l.sku === sku) ?? []
    if (!lines.length) continue
    rows.push({
      outboundNo: o.outboundNo,
      qty: lines.reduce((sum, l) => sum + l.qty, 0),
      status: o.status,
      statusLabel: statusLabels[o.status] ?? o.status,
      refNo: o.refNo || o.orderNo,
      destination: o.destination,
      warehouse: o.warehouse,
      createdAt: o.createdAt,
      trackingNo: o.trackingNo,
      appointmentDate: o.scheduledDeliveryDate,
    })
  }
  return rows
}

export async function loadSkuOutboundLogs(
  customerCode: string | null | undefined,
  sku: string,
  localOrders: OutboundOrder[],
): Promise<{ items: SkuOutboundLogRow[]; erpUnavailable?: boolean; needCustomer?: boolean }> {
  const map = new Map<string, SkuOutboundLogRow>()

  for (const row of findLocalSkuOutbounds(localOrders, sku)) {
    map.set(row.outboundNo, row)
  }

  const code = customerCode?.trim()
  if (!code || code === '—' || code === '全平台') {
    return {
      items: sortSkuOutboundLogs([...map.values()]),
      needCustomer: !code || code === '全平台',
    }
  }

  try {
    const erp = await fetchSkuOutboundLogs(code, sku)
    for (const item of erp.items ?? []) {
      map.set(item.outboundNo, {
        outboundNo: item.outboundNo,
        qty: item.qty,
        status: item.omsStatus || item.status,
        statusLabel: item.statusLabel || statusLabels[item.omsStatus] || item.status,
        refNo: item.refNo || item.fbaNo || undefined,
        destination: item.destination || item.fbaWarehouse || undefined,
        warehouse: item.warehouseCode,
        createdAt: formatDate(item.createdAt),
        shippedAt: item.shippedAt ? formatDate(item.shippedAt) : undefined,
        trackingNo: item.trackingNo ?? undefined,
        appointmentDate: item.appointmentDate ?? undefined,
      })
    }
  } catch {
    return { items: sortSkuOutboundLogs([...map.values()]), erpUnavailable: true }
  }

  return { items: sortSkuOutboundLogs([...map.values()]) }
}

function sortSkuOutboundLogs(rows: SkuOutboundLogRow[]) {
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
