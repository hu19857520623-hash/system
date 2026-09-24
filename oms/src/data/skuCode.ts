import type { Product } from './mockData'

/** 平台货盘客户编码 / OMS 账号 ID */
export const CATALOG_CUSTOMER_CODE = 'TKL'
export const CATALOG_CUSTOMER_ID = 'tkl'

/** 客户在 OMS 中填写的 SKU：最多 11 个字符，且不能只由空白组成。 */
export function validateCustomerSku(value: string): string | null {
  const sku = value.trim()
  if (!sku) return '请填写 SKU'
  if (sku.length >= 12) return '客户 SKU 须少于 12 位'
  return null
}

/** 货盘共享池库存行是否归属平台货盘客户 */
export function isCatalogPoolCustomerId(customerId?: string | null): boolean {
  return !customerId || customerId === CATALOG_CUSTOMER_ID
}

/** 客户可绑定/出库引用的商品：自己的 SKU，以及货盘池 SKU */
export function productVisibleToCustomer(
  product: { customerId?: string | null },
  customerId?: string | null,
): boolean {
  if (!customerId) return true
  if (!product.customerId || product.customerId === customerId) return true
  return isCatalogPoolCustomerId(product.customerId)
}

/** 客户可见 SKU（不含客户代码前缀） */
export function sanitizeCustomerSkuPart(value: string): string {
  return value.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
}

/** 生成系统内部 SKU：{客户代码}-{客户SKU}，同客户重复时追加 -2、-3 */
export function buildInternalSku(
  customerCode: string,
  customerSku: string,
  existingInternalSkus: string[] = [],
): string {
  const code = customerCode.trim().toUpperCase()
  const part = sanitizeCustomerSkuPart(customerSku)
  if (!code) throw new Error('缺少客户编码')
  if (!part) throw new Error('请填写 SKU')

  let base = `${code}-${part}`.slice(0, 50)
  const existing = new Set(existingInternalSkus.map(s => s.trim().toLowerCase()).filter(Boolean))
  if (!existing.has(base.toLowerCase())) return base

  let n = 2
  while (existing.has(`${base}-${n}`.toLowerCase())) n += 1
  return `${base}-${n}`.slice(0, 50)
}

/** OMS 客户端展示用 SKU（隐藏客户代码前缀） */
export function getCustomerSkuDisplay(
  product: Pick<Product, 'customerSku' | 'internalSku'>,
  customerCode?: string,
): string {
  if (product.customerSku?.trim()) return product.customerSku.trim()
  const code = customerCode?.trim().toUpperCase()
  const internal = product.internalSku.trim()
  if (code && internal.toUpperCase().startsWith(`${code}-`)) {
    return internal.slice(code.length + 1)
  }
  return internal
}

/** Shipping note seller SKU → customer product (customerSku or `{code}-{sku}`). */
export function productMatchesSellerSku(
  product: Pick<Product, 'customerSku' | 'internalSku'>,
  sellerSku: string,
  customerCode?: string,
): boolean {
  const q = sellerSku.trim().toLowerCase()
  if (!q) return false
  if (product.internalSku.trim().toLowerCase() === q) return true
  if ((product.customerSku || '').trim().toLowerCase() === q) return true
  if (getCustomerSkuDisplay(product, customerCode).toLowerCase() === q) return true
  const internal = product.internalSku.trim().toLowerCase()
  return q.length >= 3 && internal.endsWith(`-${q}`)
}

export function listInternalSkusForCustomer(
  products: Product[],
  customerId?: string,
): string[] {
  return products
    .filter(p => !customerId || !p.customerId || p.customerId === customerId)
    .map(p => p.internalSku)
}

/** 启动/导入时为旧数据补全 customerSku 与带客户代码前缀的 internalSku */
export function normalizeProductsWithSkuPrefix(
  products: Product[],
  customerCodeById: Map<string, string>,
  defaultCustomerCode = 'TKL0001',
): Product[] {
  const existing: string[] = []
  return products.map(p => {
    const mappedCode = p.customerId ? customerCodeById.get(p.customerId) : undefined
    const customerCode =
      mappedCode
      || (p.inCatalog && isCatalogPoolCustomerId(p.customerId) ? CATALOG_CUSTOMER_CODE : defaultCustomerCode)
    const customerSku = p.customerSku?.trim() || getCustomerSkuDisplay(p, customerCode)
    // ERP 货盘 SKU 是跨系统关联键，禁止在浏览器 hydrate 时重写前缀。
    if (p.inCatalog || isCatalogPoolCustomerId(p.customerId) || p.id.startsWith('erp-')) {
      existing.push(p.internalSku)
      return { ...p, customerSku, internalSku: p.internalSku }
    }
    const alreadyPrefixed = p.internalSku.toUpperCase().startsWith(`${customerCode.toUpperCase()}-`)
    const internalSku = alreadyPrefixed
      ? p.internalSku
      : buildInternalSku(customerCode, customerSku, existing)
    existing.push(internalSku)
    return { ...p, customerSku, internalSku }
  })
}

export function remapInventorySku<T extends { sku: string }>(
  inventory: T[],
  skuMap: Map<string, string>,
): T[] {
  return inventory.map(item => {
    const next = skuMap.get(item.sku)
    return next ? { ...item, sku: next } : item
  })
}
