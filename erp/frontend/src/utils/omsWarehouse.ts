/** OMS 履约仓库（与 oms/src/data/mockData.ts FULFILLMENT_WAREHOUSES 一致） */
export const FULFILLMENT_WAREHOUSES = [
  { id: 'jhb1', city: '约翰内斯堡' },
  { id: 'jhb3', city: '约翰内斯堡' },
  { id: 'cpt1', city: '开普敦' },
  { id: 'cpt2', city: '开普敦' },
  { id: 'dbn', city: '德班' },
] as const

export type FulfillmentWarehouseId = (typeof FULFILLMENT_WAREHOUSES)[number]['id']

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

/** OMS 仓库下拉（与 OMS 出库预约一致：jhb1 · 约翰内斯堡） */
export function omsWarehouseLabel(id: string): string {
  const w = FULFILLMENT_WAREHOUSES.find((x) => x.id === id)
  return w ? `${w.id} · ${w.city}` : id || '—'
}

/** ERP fbaWarehouse（JHB3 等）→ OMS 展示文案 */
export function outboundDestinationLabel(row: {
  fbaWarehouse?: string | null
  destination?: string | null
  platform?: string | null
  destType?: string | null
}): string {
  if (row.destination?.trim()) return row.destination.trim()
  const raw = row.fbaWarehouse?.trim()
  if (raw) {
    const omsId = ERP_FBA_TO_OMS[raw.toUpperCase()] || raw.toLowerCase()
    const labeled = omsWarehouseLabel(omsId)
    if (labeled !== omsId) return labeled
    return raw
  }
  if (row.platform === 'Takealot') return '—'
  const dt = row.destType?.trim()
  if (dt === 'cpt') return 'CPT 自提'
  if (dt === 'fba') return 'FBA 转运'
  if (dt === 'local') return '本地配送'
  return '—'
}

export function warehouseFilterOptions() {
  return [
    { value: 'all', label: '全部' },
    ...FULFILLMENT_WAREHOUSES.map((w) => ({ value: w.id, label: omsWarehouseLabel(w.id) })),
  ]
}
