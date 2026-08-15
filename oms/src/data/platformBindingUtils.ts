import {
  type Product,
  type PlatformSkuMapping,
  type PlatformBindingStatus,
  type StorePlatform,
  PLATFORM_BINDING_STATUS_LABELS,
} from './mockData'
import { getProductsSnapshot } from './inventoryStore'
import { getCustomerSkuDisplay } from './skuCode'
import { getPlatformSkuMappingsSnapshot, getStoresSnapshot } from './entityStore'

export { PLATFORM_BINDING_STATUS_LABELS }

/** 内部 SKU 的主平台条码（已绑定且生效） */
export function getPrimaryPlatformBarcode(internalSku: string): string | undefined {
  const active = getPlatformSkuMappingsSnapshot().find(
    m => m.status === 'active'
      && m.lines.some(l => l.internalSku === internalSku),
  )
  return active?.platformBarcode
}

/** 内部 SKU 关联的所有平台映射 */
export function getMappingsForSku(internalSku: string): PlatformSkuMapping[] {
  return getPlatformSkuMappingsSnapshot().filter(m => m.lines.some(l => l.internalSku === internalSku))
}

/** 按 SKU / 自定义编号 / 品名模糊搜索商品 */
export function searchProductsFuzzy(query: string, limit = 10, customerId?: string) {
  const q = query.trim().toLowerCase()
  let catalog = getProductsSnapshot()
  if (customerId) catalog = catalog.filter(p => !p.customerId || p.customerId === customerId)
  if (!q) return catalog.slice(0, limit)
  return catalog.filter(p => {
    const hay = [
      getCustomerSkuDisplay(p),
      p.customerSku,
      p.internalSku,
      p.customCode,
      p.name,
      p.declaredNameEn,
      p.declaredNameCn,
      p.outerBoxBarcode,
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  }).slice(0, limit)
}

/** 按客户 SKU / 内部 SKU / 平台条码查找商品 */
export function findProductByCode(code: string, customerId?: string) {
  const catalog = getProductsSnapshot()
  const scoped = customerId
    ? catalog.filter(p => !p.customerId || p.customerId === customerId)
    : catalog
  const q = code.trim()
  if (!q) return undefined

  const byInternal = scoped.find(p => p.internalSku === q)
  if (byInternal) return byInternal

  const qLower = q.toLowerCase()
  const byCustomer = scoped.find(p => {
    const display = getCustomerSkuDisplay(p).toLowerCase()
    return display === qLower || (p.customerSku || '').toLowerCase() === qLower
  })
  if (byCustomer) return byCustomer

  const mapping = getPlatformSkuMappingsSnapshot().find(
    m => m.platformBarcode === code
      || (m.status === 'active' && m.lines.some(l => scoped.some(p => p.internalSku === l.internalSku && l.internalSku === code))),
  )
  if (!mapping?.lines[0]) return undefined
  return scoped.find(p => p.internalSku === mapping.lines[0].internalSku)
}

export interface PlatformBarcodeResolveScope {
  customerId?: string
  sellerId?: string
  platform?: StorePlatform
}

interface PlatformBarcodeResolutionBase {
  barcode: string
  mappings: PlatformSkuMapping[]
}

export type PlatformBarcodeResolution =
  | (PlatformBarcodeResolutionBase & {
      status: 'resolved'
      product: Product
      mapping: PlatformSkuMapping
    })
  | (PlatformBarcodeResolutionBase & {
      status: 'unmatched'
      reason: string
    })
  | (PlatformBarcodeResolutionBase & {
      status: 'ambiguous'
      products: Product[]
      reason: string
    })

/**
 * Resolve one platform barcode only when the seller/customer/platform scope points
 * to exactly one active mapping and exactly one internal product.
 */
export function resolvePlatformBarcode(
  barcode: string,
  scope: PlatformBarcodeResolveScope = {},
): PlatformBarcodeResolution {
  const normalized = barcode.trim()
  const platform = scope.platform ?? 'Takealot'
  let mappings = getPlatformSkuMappingsSnapshot().filter(mapping =>
    mapping.platform === platform
    && mapping.platformBarcode === normalized
    && (!scope.customerId || !mapping.customerId || mapping.customerId === scope.customerId))

  if (scope.sellerId) {
    const scopedStores = getStoresSnapshot().filter(store =>
      store.platform === platform
      && store.sellerId === scope.sellerId
      && (!scope.customerId || !store.customerId || store.customerId === scope.customerId))
    const storeIds = new Set(scopedStores.map(store => store.id))
    mappings = mappings.filter(mapping =>
      mapping.sellerId === scope.sellerId
      || (!mapping.sellerId && storeIds.has(mapping.storeId)))
  }

  const activeMappings = mappings.filter(mapping => mapping.status === 'active')
  if (!activeMappings.length) {
    return {
      barcode: normalized,
      status: 'unmatched',
      mappings,
      reason: mappings.length
        ? '条码映射未生效或尚未绑定仓库 SKU'
        : '当前 Seller / 客户 / 平台范围内没有条码映射',
    }
  }

  const productsBySku = new Map<string, Product>()
  const catalog = getProductsSnapshot().filter(product =>
    !scope.customerId || !product.customerId || product.customerId === scope.customerId)
  for (const mapping of activeMappings) {
    for (const line of mapping.lines) {
      const product = catalog.find(item => item.internalSku === line.internalSku)
      if (product) productsBySku.set(product.internalSku, product)
    }
  }
  const products = [...productsBySku.values()]

  if (products.length === 0) {
    return {
      barcode: normalized,
      status: 'unmatched',
      mappings: activeMappings,
      reason: '映射指向的仓库 SKU 不在当前客户商品范围内',
    }
  }
  if (products.length !== 1 || activeMappings.length !== 1 || activeMappings[0].lines.length !== 1) {
    return {
      barcode: normalized,
      status: 'ambiguous',
      mappings: activeMappings,
      products,
      reason: '条码对应多个映射或组合商品，无法唯一确定仓库 SKU',
    }
  }

  return {
    barcode: normalized,
    status: 'resolved',
    mappings: activeMappings,
    mapping: activeMappings[0],
    product: products[0],
  }
}

export function resolvePlatformBarcodes(
  barcodes: Iterable<string>,
  scope: PlatformBarcodeResolveScope = {},
): PlatformBarcodeResolution[] {
  return [...new Set([...barcodes].map(value => value.trim()).filter(Boolean))]
    .map(barcode => resolvePlatformBarcode(barcode, scope))
}

export function platformBindingStatusLabel(status: PlatformBindingStatus): string {
  return PLATFORM_BINDING_STATUS_LABELS[status]
}

export type PlatformBindingTab = 'all' | 'unmapped' | 'active' | 'barcode_mismatch' | 'pending_review'

export function filterBindingsByTab(list: PlatformSkuMapping[], tab: PlatformBindingTab): PlatformSkuMapping[] {
  if (tab === 'all') return list
  if (tab === 'unmapped') return list.filter(m => m.status === 'unmapped')
  if (tab === 'active') return list.filter(m => m.status === 'active')
  if (tab === 'barcode_mismatch') return list.filter(m => m.status === 'barcode_mismatch')
  if (tab === 'pending_review') return list.filter(m => m.status === 'pending_review')
  return list
}

export interface PlatformBindingFilters {
  platform: string
  barcode: string
  platformTitle: string
  warehouseSku: string
  warehouseName: string
  storeId: string
}

export const defaultPlatformBindingFilters: PlatformBindingFilters = {
  platform: '',
  barcode: '',
  platformTitle: '',
  warehouseSku: '',
  warehouseName: '',
  storeId: 'all',
}

export function applyPlatformBindingFilters(
  list: PlatformSkuMapping[],
  f: PlatformBindingFilters,
): PlatformSkuMapping[] {
  return list.filter(m => {
    if (f.storeId !== 'all' && m.storeId !== f.storeId) return false
    if (f.platform && !m.platform.toLowerCase().includes(f.platform.toLowerCase())) return false
    if (f.barcode && !m.platformBarcode.includes(f.barcode)) return false
    if (f.platformTitle && !m.platformTitle.toLowerCase().includes(f.platformTitle.toLowerCase())) return false
    const whSkus = m.lines.map(l => l.internalSku).join(' ')
    const whNames = m.lines.map(l => l.warehouseName).join(' ')
    if (f.warehouseSku && !whSkus.toLowerCase().includes(f.warehouseSku.toLowerCase())) return false
    if (f.warehouseName && !whNames.toLowerCase().includes(f.warehouseName.toLowerCase())) return false
    return true
  })
}

export function bindingTabCounts(list: PlatformSkuMapping[]) {
  return {
    all: list.length,
    unmapped: list.filter(m => m.status === 'unmapped').length,
    active: list.filter(m => m.status === 'active').length,
    barcode_mismatch: list.filter(m => m.status === 'barcode_mismatch').length,
    pending_review: list.filter(m => m.status === 'pending_review').length,
  }
}
