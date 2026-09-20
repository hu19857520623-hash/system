/**
 * Takealot 平台目的仓 / OMS 履约仓 id（JHB1、JHB3、CPT、DBN 等）。
 * 枚举与匹配别名由 ERP「Takealot 目的仓」配置维护；此处静态表仅作 API 未加载时的兜底。
 */
import type { TakealotDestItem } from '@/composables/useTakealotDestConfig.ts'

export const FULFILLMENT_WAREHOUSES = [
  { id: 'jhb1', city: '约翰内斯堡' },
  { id: 'jhb3', city: '约翰内斯堡' },
  { id: 'cpt1', city: '开普敦' },
  { id: 'cpt2', city: '开普敦' },
  { id: 'dbn', city: '德班' },
] as const

export type FulfillmentWarehouseId = (typeof FULFILLMENT_WAREHOUSES)[number]['id']

let runtimeDestRows: TakealotDestItem[] | null = null

export function applyTakealotDestRuntimeRows(rows: TakealotDestItem[]) {
  runtimeDestRows = rows.length ? rows : null
}

const ERP_FBA_TO_OMS: Record<string, FulfillmentWarehouseId> = {
  JHB1: 'jhb1',
  JHB3: 'jhb3',
  JHB: 'jhb3',
  CPT1: 'cpt1',
  CPT2: 'cpt2',
  CPT: 'cpt1',
  DBN: 'dbn',
  DBN1: 'dbn',
}

function enabledRuntimeRows(): TakealotDestItem[] {
  return (runtimeDestRows || []).filter((r) => r.enabled)
}

function omsIdFromErpCode(upper: string): string | undefined {
  for (const row of enabledRuntimeRows()) {
    const aliases = [row.code, ...(row.matchAliases || [])].map((c) => c.toUpperCase())
    if (aliases.includes(upper)) {
      return row.omsWarehouseId || row.code.toLowerCase()
    }
  }
  return ERP_FBA_TO_OMS[upper]
}

/** OMS 仓库下拉（与客户出库单 Takealot 目的仓一致：JHB3 · 约翰内斯堡） */
export function omsWarehouseLabel(id: string): string {
  const w = String(id || '').trim().toLowerCase()
  if (!w || w === 'jhb' || w.includes('wms-jhb')) return 'JHB · 约翰内斯堡'
  for (const row of enabledRuntimeRows()) {
    if (row.omsWarehouseId === w) {
      const code = row.omsWarehouseId.toUpperCase()
      return row.city ? `${code} · ${row.city}` : row.label || code
    }
  }
  const hit = FULFILLMENT_WAREHOUSES.find((x) => x.id === w)
  return hit ? `${hit.id.toUpperCase()} · ${hit.city}` : id || '—'
}

/** ERP fbaWarehouse（JHB / JHB3 等）→ 客户出库单地点分类 */
export function outboundDestinationLabel(row: {
  fbaWarehouse?: string | null
  destination?: string | null
  platform?: string | null
  destType?: string | null
}): string {
  if (row.destination?.trim()) return row.destination.trim()
  const raw = row.fbaWarehouse?.trim()
  if (raw) {
    const upper = raw.toUpperCase()
    if (upper === 'JHB') return 'JHB · 约翰内斯堡'
    const omsId = omsIdFromErpCode(upper) || raw.toLowerCase()
    const labeled = omsWarehouseLabel(omsId)
    if (labeled !== omsId) return labeled
    for (const dest of enabledRuntimeRows()) {
      if (dest.code === upper) {
        return dest.city ? `${dest.code} · ${dest.city}` : dest.label
      }
    }
    return raw
  }
  if (row.platform === 'Takealot') return '—'
  const dt = row.destType?.trim()
  if (dt === 'cpt') return 'CPT 自提'
  if (dt === 'fba') return 'FBA 转运'
  if (dt === 'local') return '本地配送'
  return '—'
}

/** @deprecated 请使用 useTakealotDestConfig().billingOptions */
export const TAKEALOT_DEST_OPTIONS = [
  { value: 'JHB', label: 'JHB · 约翰内斯堡' },
  { value: 'JHB1', label: 'JHB1 · 约翰内斯堡' },
  { value: 'JHB3', label: 'JHB3 · 约翰内斯堡' },
  { value: 'CPT1', label: 'CPT1 · 开普敦' },
  { value: 'CPT2', label: 'CPT2 · 开普敦' },
  { value: 'DBN', label: 'DBN · 德班' },
  { value: 'DBN1', label: 'DBN1 · 德班' },
] as const

export const TAKEALOT_DEST_FILTER_HINT =
  'Takealot 平台目的仓由「Takealot 目的仓配置」维护，与 WMS 仓库主数据（WMS-JHB-01 等）分开管理。'

/** @deprecated 请 useTakealotDestConfig().outboundFilterOptions */
export function warehouseFilterOptions() {
  const seen = new Set<string>()
  const opts: { value: string; label: string }[] = [{ value: 'all', label: '全部' }]
  const rows = enabledRuntimeRows()
  if (rows.length) {
    for (const row of rows) {
      if (!row.omsWarehouseId || seen.has(row.omsWarehouseId)) continue
      seen.add(row.omsWarehouseId)
      opts.push({ value: row.omsWarehouseId, label: omsWarehouseLabel(row.omsWarehouseId) })
    }
    return opts
  }
  return [
    { value: 'all', label: '全部' },
    ...FULFILLMENT_WAREHOUSES.map((w) => ({ value: w.id, label: omsWarehouseLabel(w.id) })),
  ]
}
