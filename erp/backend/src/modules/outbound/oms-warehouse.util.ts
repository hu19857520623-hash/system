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

export function outboundDestinationLabel(row: {
  fbaWarehouse?: string | null
  platform?: string | null
  destType?: string | null
}): string {
  const raw = row.fbaWarehouse?.trim()
  if (raw) {
    const omsId = ERP_FBA_TO_OMS[raw.toUpperCase()] || raw.toLowerCase()
    const city = OMS_WH_CITY[omsId]
    if (city) return `${omsId} · ${city}`
    return raw
  }
  const dt = row.destType?.trim()
  if (dt === 'cpt') return 'CPT 自提'
  if (dt === 'fba') return 'FBA 转运'
  if (dt === 'local') return '本地配送'
  return '—'
}
