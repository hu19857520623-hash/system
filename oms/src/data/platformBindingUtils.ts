import {
  type Product,
  type PlatformSkuMapping,
  type PlatformBindingStatus,
  type StorePlatform,
  type StoreAccount,
  PLATFORM_BINDING_STATUS_LABELS,
} from './mockData'
import { getProductsSnapshot } from './inventoryStore'
import {
  mappingBelongsToCustomer,
  mappingsForInternalSku,
  pickPrimaryPlatformBarcode,
} from './platformBarcodeScope'
import { getCustomerSkuDisplay, productMatchesSellerSku, productVisibleToCustomer } from './skuCode'
import { getPlatformSkuMappingsSnapshot, getStoresSnapshot } from './entityStore'

export { PLATFORM_BINDING_STATUS_LABELS }

/** 内部 SKU 在当前客户下的主平台条码（已绑定且生效）。990 按客户绑定，货盘 SKU 不共用。 */
export function getPrimaryPlatformBarcode(internalSku: string, customerId?: string): string | undefined {
  return pickPrimaryPlatformBarcode(getPlatformSkuMappingsSnapshot(), internalSku, customerId)
}

/** 内部 SKU 关联的平台映射（可按客户隔离） */
export function getMappingsForSku(internalSku: string, customerId?: string): PlatformSkuMapping[] {
  return mappingsForInternalSku(getPlatformSkuMappingsSnapshot(), internalSku, customerId)
}

/** 按 SKU / 自定义编号 / 品名模糊搜索商品 */
export function searchProductsFuzzy(query: string, limit = 10, customerId?: string) {
  const q = query.trim().toLowerCase()
  let catalog = getProductsSnapshot()
  if (customerId) catalog = catalog.filter(p => productVisibleToCustomer(p, customerId))
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
    ? catalog.filter(p => productVisibleToCustomer(p, customerId))
    : catalog
  const q = code.trim()
  if (!q) return undefined

  const byInternal = scoped.find(p => p.internalSku === q)
  if (byInternal) return byInternal

  const byCustomer = scoped.find(p => productMatchesSellerSku(p, q))
  if (byCustomer) return byCustomer

  const mapping = getPlatformSkuMappingsSnapshot().find(
    m => mappingBelongsToCustomer(m, customerId) && (
      m.platformBarcode === q
      || (m.status === 'active' && m.lines.some(l => scoped.some(p => p.internalSku === l.internalSku && l.internalSku === code)))
    ),
  )
  if (!mapping?.lines[0]) return undefined
  return scoped.find(p => p.internalSku === mapping.lines[0].internalSku)
}

export interface PlatformBarcodeResolveScope {
  customerId?: string
  sellerId?: string
  platform?: StorePlatform
}

/** 绑定 990 码时使用的 Takealot 店铺（内部记录用，页面不展示平台绑定） */
export function firstTakealotStore(stores: StoreAccount[]): StoreAccount | undefined {
  return stores.find(s => s.platform === 'Takealot' && s.status === 'connected')
    ?? stores.find(s => s.platform === 'Takealot')
}
export function findTakealotStoresForSeller(
  sellerId: string | undefined,
  customerId?: string,
): StoreAccount[] {
  const platform = 'Takealot' as const
  const stores = getStoresSnapshot().filter(store =>
    store.platform === platform
    && store.status !== 'disabled'
    && (!customerId || !store.customerId || store.customerId === customerId))
  if (!sellerId?.trim()) return stores
  return stores.filter(store => store.sellerId === sellerId.trim())
}

export function pickTakealotStoreForBinding(
  sellerId: string | undefined,
  customerId?: string,
  preferredStoreId?: string,
): StoreAccount | undefined {
  const strict = findTakealotStoresForSeller(sellerId, customerId)
  const candidates = strict.length
    ? strict
    : getStoresSnapshot().filter(store =>
      store.platform === 'Takealot'
      && store.status === 'connected'
      && (!customerId || !store.customerId || store.customerId === customerId))
  if (preferredStoreId) {
    const preferred = candidates.find(store => store.id === preferredStoreId)
    if (preferred) return preferred
  }
  return candidates[0]
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
    && mappingBelongsToCustomer(mapping, scope.customerId))

  if (scope.sellerId) {
    const scopedStores = findTakealotStoresForSeller(scope.sellerId, scope.customerId)
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
}

export const defaultPlatformBindingFilters: PlatformBindingFilters = {
  platform: '',
  barcode: '',
  platformTitle: '',
  warehouseSku: '',
  warehouseName: '',
}

export function applyPlatformBindingFilters(
  list: PlatformSkuMapping[],
  f: PlatformBindingFilters,
): PlatformSkuMapping[] {
  return list.filter(m => {
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
