import { buildInternalSku } from './sku-code.util'

/** 平台货盘在 ERP/OMS 中的客户编码（与 TKL0001 等 OMS 客户编码区分） */
export const CATALOG_CUSTOMER_CODE = 'TKL'

/** 货盘定价池 SKU → 系统内部 SKU：TKL-{原SKU}；已带前缀则不再重复拼接 */
export function toCatalogInternalSku(baseSku: string, existingInternalSkus: string[] = []): string {
  const trimmed = String(baseSku || '').trim()
  if (!trimmed) throw new Error('请填写 SKU')
  if (isCatalogInternalSku(trimmed)) return trimmed.slice(0, 30)
  return buildInternalSku(CATALOG_CUSTOMER_CODE, trimmed, existingInternalSkus)
}

/** 从货盘内部 SKU 还原基础 SKU（product 表仍用 TK-xxxxx） */
export function catalogBaseSkuFromInternal(catalogSku: string): string {
  const code = CATALOG_CUSTOMER_CODE.toUpperCase()
  const trimmed = catalogSku.trim()
  if (trimmed.toUpperCase().startsWith(`${code}-`)) {
    return trimmed.slice(code.length + 1)
  }
  return trimmed
}

export function isCatalogInternalSku(sku: string): boolean {
  const trimmed = sku.trim()
  return trimmed.toUpperCase().startsWith(`${CATALOG_CUSTOMER_CODE}-`)
}

/** 货盘内部 SKU 与选品/库存基础 SKU，查询时两边都要能对上 */
export function catalogSkuLookupKeys(sku: string): string[] {
  const trimmed = String(sku || '').trim()
  if (!trimmed) return []
  const internal = toCatalogInternalSku(trimmed)
  const base = catalogBaseSkuFromInternal(internal)
  return [...new Set([internal, base, trimmed].filter(Boolean))]
}
