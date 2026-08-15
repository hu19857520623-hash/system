/** 系统唯一海外仓（JHB）标准编码与展示名 */
export const JHB_WAREHOUSE_CODE = 'WMS-JHB-01'
export const JHB_WAREHOUSE_NAME = 'JHB'

/** 将 OMS/ERP 各类 JHB 别名统一为 WMS-JHB-01 */
export function normalizeToJhbWarehouseCode(raw: string | null | undefined): string {
  const w = String(raw || '').trim().toLowerCase()
  if (!w || w === 'jhb1' || w.includes('jhb') || w.includes('wms-jhb') || w.includes('johannesburg')) {
    return JHB_WAREHOUSE_CODE
  }
  return String(raw || '').trim() || JHB_WAREHOUSE_CODE
}

export function isJhbWarehouseCode(raw: string | null | undefined): boolean {
  return normalizeToJhbWarehouseCode(raw) === JHB_WAREHOUSE_CODE
}

/** 统一 JHB 仓库展示文案 */
export function formatJhbWarehouseLabel(
  rawCode: string | null | undefined,
  warehouseName?: string | null,
): string {
  const normalized = normalizeToJhbWarehouseCode(rawCode)
  if (normalized === JHB_WAREHOUSE_CODE) {
    return JHB_WAREHOUSE_NAME
  }
  const code = String(rawCode || '').trim()
  const name = warehouseName?.trim()
  return name ? `${code} [${name}]` : code
}

/** ERP 仓库码与 OMS 仓库字段（如 jhb1）的模糊对应，供 SQL 筛选 */
export function expandWarehouseSearchTerms(codes: string[]): string[] {
  const terms = new Set<string>()
  for (const code of codes) {
    const raw = code.trim()
    if (!raw) continue
    terms.add(raw)
    const upper = raw.toUpperCase()
    if (upper.includes('JHB') || upper.includes('WMS-JHB')) {
      for (const alias of ['jhb1', 'JHB', 'JHB1', 'JHB3', 'WMS-JHB-01', 'jhb', 'Johannesburg']) {
        terms.add(alias)
      }
    }
    if (upper.includes('CPT')) {
      for (const alias of ['cpt1', 'CPT', 'CPT2', 'Cape Town']) terms.add(alias)
    }
    if (upper.includes('DBN')) {
      for (const alias of ['dbn1', 'DBN', 'DBN1', 'Durban']) terms.add(alias)
    }
  }
  return [...terms]
}
