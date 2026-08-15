export const PICKING_UNIT_FEE = 2.5
export const PACK_UNIT_FEE = 1.5
export const OUTBOUND_SHIP_BASE = 35
export const RELABEL_UNIT_FEE = 1.2
export const INBOUND_LABEL_UNIT_FEE = 0.3

export const OUTBOUND_STATUSES = [
  'pending_pick',
  'picking',
  'picked',
  'reviewing',
  'pending_relabel',
  'packed',
  'shipped',
  'delivered',
  'exception',
  'cancelled',
] as const

export const OUTBOUND_STATUS_LABELS: Record<string, string> = {
  pending_pick: '待拣货',
  picking: '拣货中',
  picked: '已拣货',
  reviewing: '复核中',
  pending_relabel: '待换标',
  packed: '待发运',
  shipped: '已发运',
  delivered: '已送达',
  exception: '异常',
  cancelled: '已取消',
}

/** 箱货类型：独立字段 cargo_type 的展示文案 */
export const CARGO_TYPE_LABELS: Record<string, string> = {
  takealot_inbound: 'Takealot入仓',
  fba_transfer: 'FBA转运',
  cpt_pickup: 'CPT自提',
  dropship_sku: '一件代发SKU',
  relabel_outbound: '需换标出库',
}

export function resolveCargoType(input: {
  destType?: string | null
  needsRelabel?: boolean
  platform?: string | null
  outboundType?: string | null
}): string {
  if (input.needsRelabel) return 'relabel_outbound'
  if (input.outboundType === 'takealot' || input.platform === 'Takealot') return 'takealot_inbound'
  if (input.destType === 'fba') return 'fba_transfer'
  if (input.destType === 'cpt') return 'cpt_pickup'
  return 'dropship_sku'
}

export function cargoTypeLabel(code?: string | null): string {
  if (!code) return '—'
  return CARGO_TYPE_LABELS[code] || code
}

export const APPOINTMENT_LABELS: Record<string, string> = {
  none: '未预约',
  pending: '待预约',
  scheduled: '已预约',
  completed: '预约完成',
}

export const PICK_SOURCES = ['pda', 'pick_list'] as const
export type PickSource = (typeof PICK_SOURCES)[number]

export const REVIEW_SOURCES = ['pda', 'pick_list'] as const
export type ReviewSource = (typeof REVIEW_SOURCES)[number]

export const PICK_SOURCE_LABELS: Record<string, string> = {
  pda: 'PDA拣货',
  pick_list: '拣货单',
}

export const REVIEW_SOURCE_LABELS: Record<string, string> = {
  pda: 'PDA复核',
  pick_list: '拣货单复核',
}

export function parseWorkDate(value?: string | null): Date | null {
  const raw = value?.trim()
  if (!raw) return null
  const dtMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (dtMatch) {
    const date = new Date(
      Number(dtMatch[1]),
      Number(dtMatch[2]) - 1,
      Number(dtMatch[3]),
      Number(dtMatch[4]),
      Number(dtMatch[5]),
      Number(dtMatch[6] || 0),
    )
    return Number.isNaN(date.getTime()) ? null : date
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatWorkDate(d: Date | null | undefined): string {
  if (!d) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = d.getHours()
  const min = d.getMinutes()
  if (h !== 0 || min !== 0) {
    return `${y}-${m}-${day} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  return `${y}-${m}-${day}`
}

export function normalizeScanCode(value?: string | null): string {
  return (value || '').trim().toUpperCase()
}

export function barcodeMatchesProduct(scan: string, product: { sku: string; barcode?: string | null }): boolean {
  const code = normalizeScanCode(scan)
  if (!code) return false
  if (normalizeScanCode(product.sku) === code) return true
  if (product.barcode && normalizeScanCode(product.barcode) === code) return true
  return false
}

export function summarizeSkus(items: Array<{ sku: string }>): string {
  if (!items.length) return '—'
  return items.length === 1 ? items[0].sku : `${items[0].sku} 等 ${items.length} SKU`
}

export function summarizeRemark(remark: string | null | undefined): string {
  const value = remark?.trim()
  if (!value) return ''
  return value.length > 40 ? `${value.slice(0, 40)}…` : value
}
