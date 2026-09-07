import {
  inferTakealotDestFromWarehouseHint,
  outboundDestinationLabel,
  takealotDestCategory,
} from '../outbound/oms-warehouse.util'

export type ChargeSkuItem = {
  sku: string
  productName: string
  quantity: number
}

export type ChargeFulfillment = {
  destination: string
  skuItems: ChargeSkuItem[]
}

function recipientPlace(recipientJson?: string | null): string {
  if (!recipientJson) return ''
  try {
    const raw = JSON.parse(recipientJson) as { city?: string; province?: string; address1?: string }
    return [raw.city || raw.province, raw.address1]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' · ')
  } catch {
    return ''
  }
}

function joinPlace(...parts: Array<string | null | undefined>): string {
  return parts.map((part) => String(part || '').trim()).filter((part) => part && part !== '—').join(' · ')
}

export function outboundChargeFulfillment(order: {
  fbaWarehouse?: string | null
  platform?: string | null
  destType?: string | null
  recipientJson?: string | null
  warehouseCode?: string | null
  items?: Array<{ sku: string; productName?: string | null; qty: number; pickedQty?: number | null }>
}): ChargeFulfillment {
  const takealotDest = takealotDestCategory(order.fbaWarehouse)?.value
  if (takealotDest) {
    return { destination: takealotDest, skuItems: buildOutboundSkuItems(order.items) }
  }
  const hub = outboundDestinationLabel(order)
  const destination = joinPlace(hub, recipientPlace(order.recipientJson))
    || inferTakealotDestFromWarehouseHint(order.warehouseCode)
    || order.warehouseCode
    || '—'
  return { destination, skuItems: buildOutboundSkuItems(order.items) }
}

function buildOutboundSkuItems(
  items?: Array<{ sku: string; productName?: string | null; qty: number; pickedQty?: number | null }>,
): ChargeSkuItem[] {
  return (items || [])
    .map((item) => ({
      sku: String(item.sku || '').trim(),
      productName: String(item.productName || '').trim(),
      quantity: Number(item.pickedQty || item.qty || 0),
    }))
    .filter((item) => item.sku && item.quantity > 0)
}

export function inboundChargeFulfillment(order: {
  warehouseCode?: string | null
  warehouseName?: string | null
  warehouseCity?: string | null
  items?: Array<{ sku: string; productName?: string | null; expectedQty: number; actualQty?: number | null }>
}): ChargeFulfillment {
  const destination = joinPlace(order.warehouseName || order.warehouseCode, order.warehouseCity) || '—'
  const skuItems = (order.items || [])
    .map((item) => ({
      sku: String(item.sku || '').trim(),
      productName: String(item.productName || '').trim(),
      quantity: Number(item.actualQty ?? item.expectedQty ?? 0),
    }))
    .filter((item) => item.sku && item.quantity > 0)
  return { destination, skuItems }
}

export function returnChargeFulfillment(order: {
  returnWarehouse?: string | null
  warehouseName?: string | null
  items?: Array<{ sku: string; productName?: string | null; quantity: number }>
}): ChargeFulfillment {
  const takealotDest = takealotDestCategory(order.returnWarehouse)?.value
  const destination = takealotDest
    || inferTakealotDestFromWarehouseHint(order.returnWarehouse, order.warehouseName)
    || order.returnWarehouse
    || '—'
  const skuItems = (order.items || [])
    .map((item) => ({
      sku: String(item.sku || '').trim(),
      productName: String(item.productName || '').trim(),
      quantity: Number(item.quantity || 0),
    }))
    .filter((item) => item.sku && item.quantity > 0)
  return { destination, skuItems }
}

export function formatSkuSummary(items: ChargeSkuItem[]): string {
  return items.map((item) => `${item.sku}×${item.quantity}`).join('；')
}

export const CHARGE_DESTINATION_FILTER_OPTIONS = [
  { value: 'JHB', label: 'JHB' },
  { value: 'JHB3', label: 'JHB3' },
  { value: 'CPT1', label: 'CPT1' },
  { value: 'CPT2', label: 'CPT2' },
  { value: 'DBN', label: 'DBN' },
  { value: 'cpt', label: 'CPT 自提' },
  { value: 'fba', label: 'FBA 转运' },
  { value: 'local', label: '本地配送' },
] as const

export const DESTINATION_JOIN_SQL = `
LEFT JOIN outbound_order dest_ob ON dest_ob.outbound_no = c.biz_ref
LEFT JOIN inbound_order dest_ib ON dest_ib.inbound_no = c.biz_ref
LEFT JOIN warehouse dest_wh ON dest_wh.warehouse_code = COALESCE(dest_ib.warehouse_code, dest_ob.warehouse_code, c.warehouse_code)`

const DEST_TYPE_FILTERS = new Set(['cpt', 'fba', 'local'])

export function resolveDestinationFilter(raw?: string | null): {
  destTypes: string[]
  fbaCodes: string[]
  likes: string[]
} | null {
  const value = String(raw || '').trim()
  if (!value || value === 'all') return null
  const option = CHARGE_DESTINATION_FILTER_OPTIONS.find(
    (item) => item.value === value || item.label === value || item.value.toLowerCase() === value.toLowerCase(),
  )
  const key = (option?.value || value).trim()
  const keyLower = key.toLowerCase()
  if (DEST_TYPE_FILTERS.has(keyLower)) {
    return { destTypes: [keyLower], fbaCodes: [], likes: [] }
  }
  const category = takealotDestCategory(option?.value || value)
  if (category) {
    return { destTypes: [], fbaCodes: [...category.fbaCodes], likes: [] }
  }
  return { destTypes: [], fbaCodes: [], likes: [value] }
}

export function applyDestinationSqlFilter(
  conds: string[],
  params: unknown[],
  destination?: string | null,
  extraBizRefs: string[] = [],
) {
  const resolved = resolveDestinationFilter(destination)
  if (!resolved) return
  const parts: string[] = []
  if (resolved.fbaCodes.length) {
    const placeholders = resolved.fbaCodes.map(() => '?').join(', ')
    parts.push(`UPPER(IFNULL(dest_ob.fba_warehouse, '')) IN (${placeholders})`)
    params.push(...resolved.fbaCodes.map((code) => code.toUpperCase()))
  }
  if (resolved.destTypes.length) {
    const placeholders = resolved.destTypes.map(() => '?').join(', ')
    parts.push(`dest_ob.dest_type IN (${placeholders})`)
    params.push(...resolved.destTypes)
  }
  for (const like of resolved.likes) {
    const needle = `%${like}%`
    parts.push('dest_ob.fba_warehouse LIKE ?')
    params.push(needle)
    parts.push('dest_ob.dest_type LIKE ?')
    params.push(needle)
    parts.push('dest_ob.warehouse_code LIKE ?')
    params.push(needle)
    parts.push('dest_ib.warehouse_code LIKE ?')
    params.push(needle)
    parts.push('c.warehouse_code LIKE ?')
    params.push(needle)
    parts.push('dest_wh.warehouse_code LIKE ?')
    params.push(needle)
    parts.push('dest_wh.warehouse_name LIKE ?')
    params.push(needle)
    parts.push('dest_wh.city LIKE ?')
    params.push(needle)
  }
  if (extraBizRefs.length) {
    const placeholders = extraBizRefs.map(() => '?').join(', ')
    parts.push(`c.biz_ref IN (${placeholders})`)
    params.push(...extraBizRefs)
  }
  if (parts.length) conds.push(`(${parts.join(' OR ')})`)
}
