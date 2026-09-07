/** OMS 履约仓库 id → ERP outbound fbaWarehouse 编码 */
const OMS_TO_ERP_FBA: Record<string, string[]> = {
  jhb1: ['JHB1'],
  jhb3: ['JHB3', 'JHB'],
  cpt1: ['CPT1', 'CPT'],
  cpt2: ['CPT2'],
  dbn: ['DBN', 'DBN1'],
}

const ERP_FBA_TO_OMS: Record<string, string> = {
  JHB1: 'jhb1',
  JHB3: 'jhb3',
  JHB: 'jhb3',
  CPT1: 'cpt1',
  CPT2: 'cpt2',
  CPT: 'cpt1',
  DBN: 'dbn',
  DBN1: 'dbn',
}

const OMS_WH_CITY: Record<string, string> = {
  jhb1: '约翰内斯堡',
  jhb3: '约翰内斯堡',
  cpt1: '开普敦',
  cpt2: '开普敦',
  dbn: '德班',
}

export function erpFbaCodesForOmsWarehouse(omsId: string): string[] | null {
  const key = omsId.trim().toLowerCase()
  return OMS_TO_ERP_FBA[key] ?? null
}

export function destinationHubCityNeedles(omsId: string): string[] {
  const city = OMS_WH_CITY[omsId.trim().toLowerCase()]
  if (!city) return []
  if (city === '约翰内斯堡') return [city, 'Johannesburg']
  if (city === '开普敦') return [city, 'Cape Town']
  if (city === '德班') return [city, 'Durban']
  return [city]
}

/** 客户出库单目的仓分类（Takealot：JHB / JHB3 / CPT1 / CPT2 / DBN） */
export const TAKEALOT_DEST_CATEGORIES = [
  { value: 'JHB', label: 'JHB', fbaCodes: ['JHB', 'JHB1'] },
  { value: 'JHB3', label: 'JHB3', fbaCodes: ['JHB3'] },
  { value: 'CPT1', label: 'CPT1', fbaCodes: ['CPT1', 'CPT'] },
  { value: 'CPT2', label: 'CPT2', fbaCodes: ['CPT2'] },
  { value: 'DBN', label: 'DBN', fbaCodes: ['DBN', 'DBN1'] },
] as const

const OMS_ID_TO_DEST_CATEGORY: Record<string, string> = {
  jhb: 'JHB',
  jhb1: 'JHB',
  jhb3: 'JHB3',
  cpt1: 'CPT1',
  cpt2: 'CPT2',
  dbn: 'DBN',
}

export function takealotDestCategory(raw?: string | null): (typeof TAKEALOT_DEST_CATEGORIES)[number] | null {
  const key = String(raw || '').trim()
  if (!key) return null
  const upper = key.toUpperCase()
  const lower = key.toLowerCase()
  const fromOms = OMS_ID_TO_DEST_CATEGORY[lower]
  return TAKEALOT_DEST_CATEGORIES.find((item) => (
    item.value === upper
    || item.label === key
    || item.label.toLowerCase() === lower
    || (item.fbaCodes as readonly string[]).includes(upper)
    || item.value === fromOms
  )) || null
}

export function takealotDestCategoryLabel(raw?: string | null): string {
  return takealotDestCategory(raw)?.value || ''
}

/** 从仓库编码/名称推断 Takealot 目的仓（费用单无出库关联时的兜底） */
export function inferTakealotDestFromWarehouseHint(...parts: Array<string | null | undefined>): string {
  const fromCode = takealotDestCategoryLabel(parts.find((p) => p)?.trim())
  if (fromCode) return fromCode
  const text = parts.map((p) => String(p || '').trim()).filter(Boolean).join(' ').toLowerCase()
  if (!text) return ''
  if (text.includes('jhb3')) return 'JHB3'
  if (text.includes('cpt2')) return 'CPT2'
  if (text.includes('cpt1') || /\bcpt\b/.test(text)) return 'CPT1'
  if (text.includes('dbn')) return 'DBN'
  if (text.includes('jhb')) return 'JHB'
  return ''
}

export function outboundDestinationLabel(row: {
  fbaWarehouse?: string | null
  platform?: string | null
  destType?: string | null
}): string {
  const category = takealotDestCategoryLabel(row.fbaWarehouse)
  if (category) return category
  const raw = row.fbaWarehouse?.trim()
  if (raw) return raw
  const dt = row.destType?.trim()
  if (dt === 'cpt') return 'CPT 自提'
  if (dt === 'fba') return 'FBA 转运'
  if (dt === 'local') return '本地配送'
  return '—'
}
