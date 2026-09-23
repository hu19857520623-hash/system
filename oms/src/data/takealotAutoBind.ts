import type {
  PlatformSkuMapping,
  Product,
  StockSource,
  StoreAccount,
} from './mockData'
import { mappingBelongsToCustomer } from './platformBarcodeScope'
import { productMatchesSellerSku, productVisibleToCustomer } from './skuCode'
import type { TakealotLineItem } from './takealotDocParser'

export type BindableProduct = Pick<Product, 'internalSku' | 'name'> &
  Partial<Pick<Product, 'customerId' | 'customerSku'>>

export interface TakealotAutoBindHit {
  barcode: string
  sellerSku: string
  internalSku: string
}

export interface TakealotAutoBindResult {
  mappings: PlatformSkuMapping[]
  bound: TakealotAutoBindHit[]
  unmatchedSkus: string[]
}

export function findProductsBySellerSku<T extends BindableProduct>(
  products: T[],
  sellerSku: string,
  customerId?: string,
): T[] {
  const scoped = customerId
    ? products.filter(product => productVisibleToCustomer(product, customerId))
    : products
  return scoped.filter(product => productMatchesSellerSku(product, sellerSku))
}

function mappingsForBarcode(
  mappings: PlatformSkuMapping[],
  barcode: string,
  customerId: string,
  sellerId?: string,
  storeIds?: Set<string>,
): PlatformSkuMapping[] {
  return mappings.filter(mapping =>
    mapping.platform === 'Takealot'
    && mapping.platformBarcode === barcode
    && mappingBelongsToCustomer(mapping, customerId)
    && (
      !sellerId
      || mapping.sellerId === sellerId
      || (!mapping.sellerId && storeIds?.has(mapping.storeId))
    ))
}

/**
 * Bind shipping-note 990 barcodes to the customer's warehouse SKU.
 * Does not overwrite an active mapping that already points at a different SKU.
 */
export function applyTakealotShippingNoteBindings(options: {
  items: Array<Pick<TakealotLineItem, 'barcode' | 'sku' | 'productTitle' | 'tsin'>>
  mappings: PlatformSkuMapping[]
  products: BindableProduct[]
  customerId: string
  sellerId?: string
  store?: StoreAccount
  stockSource: StockSource
  now: string
}): TakealotAutoBindResult {
  const storeIds = new Set(
    options.store ? [options.store.id] : [],
  )
  const next = [...options.mappings]
  const bound: TakealotAutoBindHit[] = []
  const unmatchedSkus: string[] = []
  const seenBarcodes = new Set<string>()

  for (const item of options.items) {
    const barcode = item.barcode?.trim()
    const sellerSku = item.sku?.trim()
    if (!barcode || !sellerSku || seenBarcodes.has(barcode)) continue
    seenBarcodes.add(barcode)

    const matches = findProductsBySellerSku(options.products, sellerSku, options.customerId)
    if (matches.length !== 1) {
      if (sellerSku !== barcode) unmatchedSkus.push(sellerSku)
      continue
    }
    const product = matches[0]
    const existing = mappingsForBarcode(
      next,
      barcode,
      options.customerId,
      options.sellerId,
      storeIds,
    )
    const active = existing.filter(mapping => mapping.status === 'active')
    if (active.length === 1 && active[0].lines.length === 1 && active[0].lines[0].internalSku === product.internalSku) {
      continue
    }
    if (active.length > 0) continue

    const line = {
      internalSku: product.internalSku,
      warehouseName: product.name,
      packType: '自带包装',
      qty: 1,
    }
    const unmapped = existing.filter(mapping => mapping.status === 'unmapped' || mapping.lines.every(item => !item.internalSku))
    if (unmapped.length === 1) {
      const target = unmapped[0]
      const index = next.findIndex(mapping => mapping.id === target.id)
      if (index >= 0) {
        next[index] = {
          ...target,
          customerId: options.customerId,
          sellerId: options.sellerId || options.store?.sellerId || target.sellerId,
          storeId: options.store?.id || target.storeId,
          storeName: options.store?.name || target.storeName,
          platformSkuId: item.tsin || target.platformSkuId,
          platformTitle: item.productTitle || target.platformTitle,
          lines: [line],
          status: target.hasInventory ? 'pending_review' : 'active',
          stockSource: options.stockSource,
          syncSource: 'import',
          version: target.version + 1,
          updatedAt: options.now,
        }
        bound.push({ barcode, sellerSku, internalSku: product.internalSku })
      }
      continue
    }
    if (existing.length > 1) continue

    next.push({
      id: `pb-note-${options.customerId}-${barcode}`,
      customerId: options.customerId,
      sellerId: options.sellerId || options.store?.sellerId,
      platform: 'Takealot',
      storeId: options.store?.id || '',
      storeName: options.store?.name || '—',
      platformSkuId: item.tsin,
      platformBarcode: barcode,
      platformTitle: item.productTitle || '',
      lines: [line],
      status: 'active',
      stockSource: options.stockSource,
      syncSource: 'import',
      version: 1,
      hasInventory: false,
      updatedAt: options.now,
    })
    bound.push({ barcode, sellerSku, internalSku: product.internalSku })
  }

  return { mappings: next, bound, unmatchedSkus }
}
