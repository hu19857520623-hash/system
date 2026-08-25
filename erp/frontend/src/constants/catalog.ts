/** 平台货盘在 ERP/OMS 中的统一客户代码 */
export const CATALOG_CUSTOMER_CODE = 'TKL'
export const CATALOG_CUSTOMER_NAME = '平台货盘'

export function isCatalogPoolCustomerCode(code?: string | null) {
  return String(code || '').trim().toUpperCase() === CATALOG_CUSTOMER_CODE
}

/** 货盘内部 SKU（TKL-xxx）→ 基础 SKU */
export function catalogBaseSkuFromInternal(sku: string) {
  const prefix = `${CATALOG_CUSTOMER_CODE}-`
  const trimmed = sku.trim()
  if (trimmed.toUpperCase().startsWith(prefix.toUpperCase())) {
    return trimmed.slice(prefix.length)
  }
  return trimmed
}
