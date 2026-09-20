import { getEnabledTakealotDestRows } from '../warehouse/takealot-dest.cache'
import type { TakealotDestRow } from '../warehouse/takealot-dest.defaults'

export type TakealotDestCategory = {
  value: string
  label: string
  fbaCodes: readonly string[]
}

function rowsForMatch(): TakealotDestRow[] {
  return getEnabledTakealotDestRows()
}

function allAliasCodes(row: TakealotDestRow): string[] {
  const codes = new Set<string>([row.code.toUpperCase(), ...row.matchAliases.map((a) => a.toUpperCase())])
  return [...codes]
}

export function erpFbaCodesForOmsWarehouse(omsId: string): string[] | null {
  const key = omsId.trim().toLowerCase()
  if (!key) return null
  const row = rowsForMatch().find((r) => r.omsWarehouseId === key)
  if (!row) return null
  return allAliasCodes(row)
}

export function destinationHubCityNeedles(omsId: string): string[] {
  const key = omsId.trim().toLowerCase()
  const row = rowsForMatch().find((r) => r.omsWarehouseId === key)
  const city = row?.city
  if (!city) return []
  if (city === '约翰内斯堡') return [city, 'Johannesburg']
  if (city === '开普敦') return [city, 'Cape Town']
  if (city === '德班') return [city, 'Durban']
  return [city]
}

export function takealotDestCategory(raw?: string | null): TakealotDestCategory | null {
  const key = String(raw || '').trim()
  if (!key) return null
  const upper = key.toUpperCase()
  const lower = key.toLowerCase()
  for (const row of rowsForMatch()) {
    const aliases = allAliasCodes(row)
    if (
      row.code === upper
      || row.label.toUpperCase() === upper
      || aliases.includes(upper)
      || row.omsWarehouseId === lower
    ) {
      return { value: row.code, label: row.label, fbaCodes: aliases }
    }
  }
  return null
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
  for (const row of [...rowsForMatch()].sort((a, b) => b.code.length - a.code.length)) {
    const tokens = [row.code, row.omsWarehouseId || '', ...row.matchAliases].filter(Boolean)
    for (const token of tokens) {
      if (text.includes(String(token).toLowerCase())) return row.code
    }
  }
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
