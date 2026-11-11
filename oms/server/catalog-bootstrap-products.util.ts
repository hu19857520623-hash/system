import type { ErpCatalogItem } from './erpClient.js'

export function customerBootstrapProducts<T extends { internalSku: string; customerId?: string | null; inCatalog: boolean }>(products: T[], customerId: string, requiredSkus: string[]) {
  const required = new Set(requiredSkus)
  return products.filter(product => product.customerId === customerId
    || (product.inCatalog && (!product.customerId || product.customerId === 'tkl') && required.has(product.internalSku)))
}

function dimensions(item: ErpCatalogItem) {
  return {
    lengthCm: item.lengthCm, widthCm: item.widthCm, heightCm: item.heightCm,
    weightKg: item.weightKg, weight: item.weightKg > 0 ? `${item.weightKg} kg` : '',
    hasBoxSpec: item.lengthCm > 0 && item.widthCm > 0 && item.heightCm > 0,
  }
}

function catalogProduct(item: ErpCatalogItem) {
  return {
    id: `erp-${item.sku}`, customerId: 'tkl', internalSku: item.sku,
    customerSku: item.sku.replace(/^TKL-/, ''), name: item.productName,
    spec: item.spec || '', image: item.imageUrl || '', price: item.price, cost: 0,
    availableQty: item.remainingStockQty, lockedQty: item.soldQty,
    category: '货盘', categoryPath: '货盘', ...dimensions(item), inCatalog: true,
    catalogStockPool: item.catalogStockPool, catalogSoldQty: item.soldQty,
    catalogVisibleOnOms: item.visibleOnOms, catalogOrderableOnOms: item.orderableOnOms,
    catalogShareStatus: item.shareStatus, catalogSyncedAt: item.syncedAt,
    productStatus: item.orderableOnOms ? 'available' as const : 'draft' as const,
    hasBattery: false, certUploaded: false, declaredNameEn: item.productName,
    declaredNameCn: item.productName, declaredValue: item.price, unit: 'pcs',
  }
}

/** Catalog products may exist only in browser memory after selection; rebuild their
 * read-only metadata on every bootstrap so shipping does not depend on visiting Catalog. */
export function catalogBootstrapProducts<T extends { internalSku: string }>(products: T[], catalog: ErpCatalogItem[], requiredSkus: string[] = []): Array<T | ReturnType<typeof catalogProduct>> {
  const bySku = new Map(catalog.map(item => [item.sku, item]))
  const result: Array<T | ReturnType<typeof catalogProduct>> = products.map(product => {
    const item = bySku.get(product.internalSku)
    return item ? { ...product, ...dimensions(item) } : product
  })
  const present = new Set(products.map(product => product.internalSku))
  const required = new Set(requiredSkus)
  for (const item of catalog) {
    if (present.has(item.sku) || !required.has(item.sku)) continue
    present.add(item.sku)
    result.push(catalogProduct(item))
  }
  return result
}
