import { useSyncExternalStore } from 'react'
import { apiDelete, apiPut, getStoredAuthSession } from '../api/client'
import { notifyPersistFailed } from '../utils/userNotify'
import { purchaseErpCatalog, type ErpCatalogItem, type ErpPurchaseResult } from '../api/erp'
import type { InventoryItem, Product } from './mockData'
import { getCustomerCode } from './dataScope'
import { setCreditBalanceFromErp } from './billingStore'
import {
  buildInternalSku,
  CATALOG_CUSTOMER_CODE,
  CATALOG_CUSTOMER_ID,
  getCustomerSkuDisplay,
  isCatalogPoolCustomerId,
  listInternalSkusForCustomer,
  normalizeProductsWithSkuPrefix,
  remapInventorySku,
  validateCustomerSku,
} from './skuCode'
import { holdingEanFromCatalogPool } from './platformBarcodeScope'

export interface CatalogPurchase {
  id: string
  purchaseNo: string
  customerId: string
  sku: string
  productName: string
  qty: number
  createdAt: string
}

interface InventoryState {
  inventory: InventoryItem[]
  products: Product[]
  purchases: CatalogPurchase[]
}

type HydrateInventoryInput = InventoryState & {
  accounts?: Array<{ id: string; code: string }>
}

let state: InventoryState = { inventory: [], products: [], purchases: [] }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

function persistPayload(): InventoryState {
  const user = getStoredAuthSession()?.user
  if (!user || user.role === 'sys_admin' || !user.customerId) return state
  const customerId = user.customerId
  return {
    products: state.products
      .filter(product => product.customerId === customerId || (!product.customerId && !product.inCatalog))
      .map(product => ({ ...product, customerId })),
    inventory: state.inventory
      .filter(item => item.customerId === customerId || (!item.customerId && item.stockSource !== 'catalog'))
      .map(item => ({ ...item, customerId })),
    purchases: state.purchases
      .filter(purchase => purchase.customerId === customerId)
      .map(purchase => ({ ...purchase, customerId })),
  }
}

function persistLocal() {
  emit()
  void apiPut('/inventory-state', persistPayload()).catch(err => notifyPersistFailed('库存', err))
}

async function persistLocalOrThrow() {
  emit()
  await apiPut('/inventory-state', persistPayload())
}

async function persistProductOrThrow(product: Product) {
  emit()
  await apiPut(`/inventory-state/products/${encodeURIComponent(product.id)}`, { product })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function hydrateInventory(next: HydrateInventoryInput) {
  const codeById = new Map((next.accounts || []).map(a => [a.id, a.code]))
  const oldProducts = structuredClone(next.products).map(product => ({
    ...product,
    // 兼容旧数据：系统已取消“审核不通过”，历史记录统一进入废弃。
    productStatus: String(product.productStatus) === 'rejected' ? 'discarded' as const : product.productStatus,
  }))
  const products = normalizeProductsWithSkuPrefix(oldProducts, codeById)
  const skuMap = new Map<string, string>()
  oldProducts.forEach((old, idx) => {
    if (old.internalSku !== products[idx].internalSku) {
      skuMap.set(old.internalSku, products[idx].internalSku)
    }
  })
  state = {
    inventory: structuredClone(remapInventorySku(next.inventory, skuMap)),
    products,
    purchases: structuredClone(next.purchases),
  }
  emit()
}

export function useInventoryItems(): InventoryItem[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().inventory, () => getSnapshot().inventory)
}

export function useProducts(): Product[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().products, () => getSnapshot().products)
}

export function useCatalogPurchases(): CatalogPurchase[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().purchases, () => getSnapshot().purchases)
}

export type LockStockResult = { ok: true; purchase: CatalogPurchase } | { ok: false; error: string }

function nextPurchaseNo(): string {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const seq = String(state.purchases.length + 1).padStart(3, '0')
  return `CAT-${date}${seq}`
}

/** 客户申购货盘商品：无 ERP 时的本地回退 */
export function purchaseCatalogProduct(
  internalSku: string,
  qty: number,
  customerId: string,
): LockStockResult {
  if (qty <= 0) return { ok: false, error: '申购数量须大于 0' }

  const product = state.products.find(p => p.internalSku === internalSku && p.inCatalog)
  if (!product) return { ok: false, error: '商品不在货盘或不存在' }
  if (product.productStatus !== 'available') return { ok: false, error: '商品当前不可申购' }

  const poolIdx = state.inventory.findIndex(
    i => i.sku === internalSku && i.stockSource === 'catalog' && isCatalogPoolCustomerId(i.customerId),
  )
  if (poolIdx < 0) return { ok: false, error: '未找到货盘共享库存' }

  const pool = state.inventory[poolIdx]
  if (pool.available < qty) {
    return { ok: false, error: `可售库存不足，当前可售 ${pool.available.toLocaleString()} 件` }
  }

  pool.available -= qty
  product.availableQty -= qty
  product.lockedQty += qty

  const custIdx = state.inventory.findIndex(
    i => i.sku === internalSku && i.stockSource === 'catalog' && i.customerId === customerId,
  )
  if (custIdx >= 0) {
    state.inventory[custIdx].locked += qty
  } else {
    state.inventory.push({
      ...pool,
      id: String(Date.now()),
      customerId,
      available: 0,
      locked: qty,
      inTransit: 0,
      pendingShelving: 0,
      pendingOutbound: 0,
    })
  }

  const purchase: CatalogPurchase = {
    id: String(Date.now()),
    purchaseNo: nextPurchaseNo(),
    customerId,
    sku: internalSku,
    productName: product.name,
    qty,
    createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
  }
  state.purchases.unshift(purchase)
  persistLocal()
  return { ok: true, purchase }
}

function applyErpPurchaseLocally(
  result: ErpPurchaseResult,
  customerId: string,
  productName: string,
) {
  const product = state.products.find(p => p.internalSku === result.sku)
  if (product) {
    product.availableQty = result.remainingStockQty
    product.lockedQty += result.quantity
    product.price = result.unitPrice
    if (result.remainingStockQty <= 0) product.productStatus = 'draft'
  }

  const poolIdx = state.inventory.findIndex(
    i => i.sku === result.sku && i.stockSource === 'catalog' && isCatalogPoolCustomerId(i.customerId),
  )
  if (poolIdx >= 0) {
    state.inventory[poolIdx].available = result.remainingStockQty
    state.inventory[poolIdx].price = result.unitPrice
  }

  const custIdx = state.inventory.findIndex(
    i => i.sku === result.sku && i.stockSource === 'catalog' && i.customerId === customerId,
  )
  if (custIdx >= 0) {
    state.inventory[custIdx].locked += result.quantity
    state.inventory[custIdx].price = result.unitPrice
  } else {
    const pool = poolIdx >= 0 ? state.inventory[poolIdx] : undefined
    state.inventory.push({
      id: `csi-${customerId}-${result.sku}`,
      customerId,
      sku: result.sku,
      name: productName || pool?.name || result.sku,
      image: pool?.image || product?.image || '',
      available: 0,
      locked: result.quantity,
      inTransit: 0,
      safetyStock: 0,
      spec: pool?.spec || product?.spec || '',
      customCode: pool?.customCode,
      ean: holdingEanFromCatalogPool(pool?.ean),
      warehouse: pool?.warehouse || product?.category || 'jhb1',
      pendingShelving: 0,
      pendingOutbound: 0,
      defective: 0,
      shipped: 0,
      warningQty: 0,
      price: result.unitPrice,
      declaredNameEn: pool?.declaredNameEn || product?.declaredNameEn,
      categoryPath: pool?.categoryPath || product?.categoryPath,
      stockSource: 'catalog',
    })
  }

  const purchase: CatalogPurchase = {
    id: String(result.id),
    purchaseNo: result.orderNo,
    customerId,
    sku: result.sku,
    productName,
    qty: result.quantity,
    createdAt: typeof result.createdAt === 'string'
      ? result.createdAt.slice(0, 19).replace('T', ' ')
      : new Date().toISOString().slice(0, 19).replace('T', ' '),
  }
  if (!state.purchases.some(p => p.purchaseNo === purchase.purchaseNo)) {
    state.purchases.unshift(purchase)
  }
  if (result.balanceAfter != null) setCreditBalanceFromErp(result.balanceAfter)
  persistLocal()
  return purchase
}

/** P0：经 OMS BFF 调用 ERP 货盘申购 */
export async function purchaseCatalogProductViaErp(
  internalSku: string,
  qty: number,
  customerId: string,
): Promise<LockStockResult> {
  if (qty <= 0) return { ok: false, error: '申购数量须大于 0' }
  const customerCode = getCustomerCode(customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '当前角色未绑定客户编码，无法向 ERP 下单' }
  }

  try {
    const result = await purchaseErpCatalog({
      customerId,
      customerCode,
      sku: internalSku,
      quantity: qty,
    })
    const productName =
      state.products.find(p => p.internalSku === internalSku)?.name || result.sku
    const purchase = applyErpPurchaseLocally(result, customerId, productName)
    return { ok: true, purchase }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 用 ERP 货盘目录覆盖本地展示用商品/库存池（归属平台货盘客户 TKL） */
export async function mergeErpCatalogIntoState(items: ErpCatalogItem[]) {
  const before = structuredClone(state)
  const existingSkus = listInternalSkusForCustomer(state.products, CATALOG_CUSTOMER_ID)
  for (const item of items) {
    const internalSku = item.sku.trim()
    const customerSku = getCustomerSkuDisplay({ internalSku, customerSku: undefined }, CATALOG_CUSTOMER_CODE)
    const existing = state.products.find(
      p => p.internalSku === internalSku || (p.inCatalog && p.customerId === CATALOG_CUSTOMER_ID && p.customerSku === customerSku),
    )
    if (existing) {
      existing.customerId = CATALOG_CUSTOMER_ID
      existing.internalSku = internalSku
      existing.customerSku = customerSku
      existing.name = item.productName || existing.name
      existing.spec = item.spec || existing.spec
      existing.price = item.price
      existing.availableQty = item.remainingStockQty
      existing.lengthCm = item.lengthCm
      existing.widthCm = item.widthCm
      existing.heightCm = item.heightCm
      existing.weightKg = item.weightKg
      existing.weight = item.weightKg > 0 ? `${item.weightKg} kg` : ''
      existing.hasBoxSpec = item.lengthCm > 0 && item.widthCm > 0 && item.heightCm > 0
      existing.catalogStockPool = item.catalogStockPool
      existing.catalogSoldQty = item.soldQty
      existing.catalogVisibleOnOms = item.visibleOnOms
      existing.catalogOrderableOnOms = item.orderableOnOms
      existing.catalogShareStatus = item.shareStatus
      existing.catalogSyncedAt = item.syncedAt
      existing.inCatalog = true
      existing.productStatus = item.orderableOnOms ? 'available' : 'draft'
    } else {
      existingSkus.push(internalSku)
      state.products.unshift({
        id: `erp-${internalSku}`,
        customerId: CATALOG_CUSTOMER_ID,
        internalSku,
        customerSku,
        name: item.productName,
        spec: item.spec || '',
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=300&fit=crop',
        price: item.price,
        cost: 0,
        availableQty: item.remainingStockQty,
        lockedQty: item.soldQty,
        customCode: undefined,
        category: '货盘',
        categoryPath: '货盘',
        weight: item.weightKg > 0 ? `${item.weightKg} kg` : '',
        weightKg: item.weightKg,
        lengthCm: item.lengthCm,
        widthCm: item.widthCm,
        heightCm: item.heightCm,
        inCatalog: true,
        catalogStockPool: item.catalogStockPool,
        catalogSoldQty: item.soldQty,
        catalogVisibleOnOms: item.visibleOnOms,
        catalogOrderableOnOms: item.orderableOnOms,
        catalogShareStatus: item.shareStatus,
        catalogSyncedAt: item.syncedAt,
        productStatus: item.orderableOnOms ? 'available' : 'draft',
        hasBattery: false,
        certUploaded: false,
        hasBoxSpec: item.lengthCm > 0 && item.widthCm > 0 && item.heightCm > 0,
        outerBoxBarcode: undefined,
        declaredNameEn: item.productName,
        declaredNameCn: item.productName,
        declaredValue: item.price,
        unit: 'pcs',
      })
    }

    const poolIdx = state.inventory.findIndex(
      i => i.sku === internalSku && i.stockSource === 'catalog' && isCatalogPoolCustomerId(i.customerId),
    )
    if (poolIdx >= 0) {
      state.inventory[poolIdx].customerId = CATALOG_CUSTOMER_ID
      state.inventory[poolIdx].available = item.remainingStockQty
      state.inventory[poolIdx].name = item.productName
      state.inventory[poolIdx].price = item.price
      state.inventory[poolIdx].spec = item.spec || state.inventory[poolIdx].spec
    } else {
      state.inventory.unshift({
        id: `erp-pool-${internalSku}`,
        customerId: CATALOG_CUSTOMER_ID,
        sku: internalSku,
        name: item.productName,
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=300&fit=crop',
        available: item.remainingStockQty,
        locked: 0,
        inTransit: 0,
        safetyStock: 0,
        spec: item.spec || '',
        warehouse: 'jhb1',
        pendingShelving: 0,
        pendingOutbound: 0,
        defective: 0,
        shipped: 0,
        warningQty: 0,
        price: item.price,
        declaredNameEn: item.productName,
        categoryPath: '货盘',
        stockSource: 'catalog',
      })
    }
  }

  const erpSkus = new Set(items.map(item => item.sku.trim().toLowerCase()).filter(Boolean))
  state.products = state.products.filter((product) => {
    if (!product.inCatalog || !isCatalogPoolCustomerId(product.customerId)) return true
    return erpSkus.has(product.internalSku.toLowerCase())
  })
  state.inventory = state.inventory.filter((item) => {
    if (item.stockSource !== 'catalog' || !isCatalogPoolCustomerId(item.customerId)) return true
    return erpSkus.has(item.sku.toLowerCase())
  })

  emit()
  try {
    await persistLocalOrThrow()
  } catch (error) {
    state = before
    emit()
    throw error
  }
}

function skuLookupKeys(sku: string): string[] {
  const trimmed = sku.trim()
  if (!trimmed) return []
  const keys = new Set([trimmed])
  const lower = trimmed.toLowerCase()
  for (const product of state.products) {
    const matches =
      product.internalSku.toLowerCase() === lower
      || (product.customerSku || '').toLowerCase() === lower
      || getCustomerSkuDisplay(product).toLowerCase() === lower
    if (!matches) continue
    keys.add(product.internalSku)
    if (product.customerSku?.trim()) keys.add(product.customerSku.trim())
  }
  return [...keys]
}

function findCustomerInventory(
  sku: string,
  stockSource: 'owned' | 'catalog',
  customerId?: string,
) {
  const keys = new Set(skuLookupKeys(sku).map(value => value.toLowerCase()))
  if (keys.size === 0) return undefined
  return state.inventory.find(item => {
    if (item.stockSource !== stockSource) return false
    if (!keys.has(item.sku.toLowerCase())) return false
    if (stockSource === 'catalog') return Boolean(customerId) && item.customerId === customerId
    return !item.customerId || item.customerId === customerId
  })
}

function findProductForSku(sku: string) {
  const keys = new Set(skuLookupKeys(sku).map(value => value.toLowerCase()))
  return state.products.find(product =>
    keys.has(product.internalSku.toLowerCase())
    || (product.customerSku ? keys.has(product.customerSku.toLowerCase()) : false),
  )
}

/** 出库 SKU 优先走客户货盘持有，没有持有再走自有可售。 */
export function resolveOutboundStockSource(
  sku: string,
  customerId?: string,
  preferred?: 'owned' | 'catalog',
): 'owned' | 'catalog' {
  if (preferred === 'catalog' || preferred === 'owned') return preferred
  const catalogQty = Math.max(0, findCustomerInventory(sku, 'catalog', customerId)?.locked ?? 0)
  return catalogQty > 0 ? 'catalog' : 'owned'
}

/** 当前客户可加入出库单的库存行（货盘看持有量，自有看可售）。 */
export function listShippableOutboundItems(
  customerId?: string,
  options?: { catalogOnly?: boolean },
): Array<{ sku: string; name: string; shippable: number; stockSource: 'owned' | 'catalog' }> {
  const catalogOnly = Boolean(options?.catalogOnly)
  const rows: Array<{ sku: string; name: string; shippable: number; stockSource: 'owned' | 'catalog' }> = []
  for (const item of state.inventory) {
    if (item.stockSource === 'catalog') {
      if (!customerId || item.customerId !== customerId) continue
      if (isCatalogPoolCustomerId(item.customerId)) continue
      const shippable = Math.max(0, item.locked)
      if (shippable <= 0) continue
      rows.push({ sku: item.sku, name: item.name, shippable, stockSource: 'catalog' })
      continue
    }
    if (catalogOnly) continue
    if (customerId && item.customerId && item.customerId !== customerId) continue
    const shippable = Math.max(0, item.available)
    if (shippable <= 0) continue
    rows.push({ sku: item.sku, name: item.name, shippable, stockSource: 'owned' })
  }
  return rows
}

/** 出库提交时锁定库存（货盘扣减客户锁定量，自有扣减可售并转锁定） */
export async function lockStockForOutbound(
  lines: { sku: string; qty: number }[],
  stockSource: 'owned' | 'catalog',
  customerId?: string,
): Promise<LockStockResult | { ok: true }> {
  const before = structuredClone(state)

  // 先完整校验，避免多 SKU 中途失败后只锁定前半部分。
  for (const line of lines) {
    const qty = line.qty
    if (qty <= 0) continue
    if (stockSource === 'catalog') {
      if (!customerId) return { ok: false, error: '货盘出库需关联客户账号' }
      const item = findCustomerInventory(line.sku, 'catalog', customerId)
      if (!item) {
        return { ok: false, error: `${line.sku} 尚未申购，请先在货盘选品申购并锁定库存` }
      }
      if (item.locked < qty) {
        return { ok: false, error: `${line.sku} 锁定库存不足（需 ${qty}，已锁定 ${item.locked}）` }
      }
      continue
    }
    const item = findCustomerInventory(line.sku, 'owned', customerId)
    if (!item) return { ok: false, error: `未找到 SKU ${line.sku} 的自有库存` }
    if (item.available < qty) {
      return { ok: false, error: `${line.sku} 可售库存不足（需 ${qty}，可售 ${item.available}）` }
    }
  }

  for (const line of lines) {
    const qty = line.qty
    if (qty <= 0) continue
    const item = findCustomerInventory(line.sku, stockSource, customerId)!
    const product = findProductForSku(item.sku)
    if (stockSource === 'catalog') {
      item.locked -= qty
      item.pendingOutbound += qty
      if (product) product.lockedQty = Math.max(0, product.lockedQty - qty)
    } else {
      item.available -= qty
      item.locked += qty
      if (product) {
        product.availableQty -= qty
        product.lockedQty += qty
      }
    }
  }
  try {
    await persistLocalOrThrow()
    return { ok: true }
  } catch (error) {
    state = before
    emit()
    return {
      ok: false,
      error: `库存锁定保存失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** ERP 出库创建失败时撤销前端已做的库存锁定。 */
export async function rollbackStockForOutbound(
  lines: { sku: string; qty: number }[],
  stockSource: 'owned' | 'catalog',
  customerId?: string,
) {
  for (const line of lines) {
    const qty = Math.max(0, Number(line.qty) || 0)
    if (!qty) continue
    const item = findCustomerInventory(line.sku, stockSource, customerId)
    if (!item) continue
    const product = findProductForSku(item.sku)
    if (stockSource === 'catalog') {
      item.locked += qty
      item.pendingOutbound = Math.max(0, item.pendingOutbound - qty)
      if (product) product.lockedQty += qty
      continue
    }
    item.available += qty
    item.locked = Math.max(0, item.locked - qty)
    if (product) {
      product.availableQty += qty
      product.lockedQty = Math.max(0, product.lockedQty - qty)
    }
  }
  await persistLocalOrThrow()
}

export function getCatalogAvailableQty(internalSku: string): number {
  const pool = state.inventory.find(
    i => i.sku === internalSku && i.stockSource === 'catalog' && isCatalogPoolCustomerId(i.customerId),
  )
  if (pool) return pool.available
  const product = state.products.find(p => p.internalSku === internalSku)
  return product?.availableQty ?? 0
}

/** 出库单行可发上限：自有库存看 available，货盘出库看客户 locked。 */
export function getOutboundShippableQty(
  sku: string,
  stockSource: 'owned' | 'catalog' | 'auto',
  customerId?: string,
): number {
  if (!sku.trim()) return 0
  const resolved = resolveOutboundStockSource(sku, customerId, stockSource === 'auto' ? undefined : stockSource)
  if (resolved === 'catalog') {
    if (!customerId) return 0
    return Math.max(0, findCustomerInventory(sku, 'catalog', customerId)?.locked ?? 0)
  }
  const item = findCustomerInventory(sku, 'owned', customerId)
  if (item) return Math.max(0, item.available)
  const product = findProductForSku(sku)
  return Math.max(0, product?.availableQty ?? 0)
}

export function getProductsSnapshot(): Product[] {
  return state.products
}

export function getInventorySnapshot(): InventoryItem[] {
  return state.inventory
}

/** 用 ERP 客户库存视图刷新货盘持有与自有仓存展示。 */
export async function refreshInventoryFromErp(customerId: string, customerCode: string): Promise<number> {
  const { syncErpInventoryView } = await import('../api/erp')
  const data = await syncErpInventoryView(customerCode)

  // Before ERP returned an explicit stock source, OMS stored every ERP mirror
  // as a catalog row (`erp-inv-*`). Keep real catalog holdings, but remove an
  // old mirror once ERP confirms the SKU is owned stock only.
  const ownedSkus = new Set(
    (data.items || [])
      .filter(item => item.stockSource === 'owned')
      .map(item => item.sku),
  )
  const catalogSkus = new Set(
    (data.items || [])
      .filter(item => item.stockSource !== 'owned')
      .map(item => item.sku),
  )
  const staleLegacyCatalogMirrors = state.inventory.filter(item => (
    item.customerId === customerId
    && item.stockSource === 'catalog'
    && item.id.startsWith('erp-inv-')
    && ownedSkus.has(item.sku)
    && !catalogSkus.has(item.sku)
  ))
  if (staleLegacyCatalogMirrors.length) {
    await Promise.all(staleLegacyCatalogMirrors.map(item => (
      apiDelete(`/inventory-state/inventory/${encodeURIComponent(item.id)}`)
    )))
    const staleIds = new Set(staleLegacyCatalogMirrors.map(item => item.id))
    state.inventory = state.inventory.filter(item => !staleIds.has(item.id))
  }

  for (const item of data.items || []) {
    const stockSource = item.stockSource === 'owned' ? 'owned' : 'catalog'
    const available = Math.max(0, Number(item.warehouseAvailable) || 0)
    const locked = stockSource === 'catalog'
      ? Math.max(0, Number(item.quantity) || 0)
      : Math.max(0, Number(item.warehouseLocked) || 0)
    const idx = state.inventory.findIndex(
      i => i.sku === item.sku && i.stockSource === stockSource && i.customerId === customerId,
    )
    if (idx >= 0) {
      state.inventory[idx].locked = locked
      state.inventory[idx].available = available
      state.inventory[idx].name = item.productName
      state.inventory[idx].price = item.unitPrice ?? state.inventory[idx].price
      state.inventory[idx].warehouse = item.warehouseCode
    } else {
      state.inventory.unshift({
        // ERP item ids are globally unique per stock source; never append the
        // SKU here because oms_inventoryitem.id is limited to 50 characters.
        id: `erp-${stockSource[0]}-${item.id}`,
        customerId,
        sku: item.sku,
        name: item.productName,
        image: '',
        available,
        locked,
        inTransit: 0,
        safetyStock: 0,
        spec: '',
        warehouse: item.warehouseCode,
        pendingShelving: 0,
        pendingOutbound: 0,
        defective: 0,
        shipped: 0,
        warningQty: 0,
        price: item.unitPrice ?? 0,
        stockSource,
      })
    }
    if (stockSource === 'owned') {
      const product = state.products.find(p => p.customerId === customerId && p.internalSku === item.sku)
      if (product) {
        product.availableQty = available
        product.lockedQty = locked
      }
    }
  }
  persistLocal()
  return data.total
}

export async function importProducts(
  items: Product[],
  opts?: { customerCode?: string; customerId?: string },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const prepared: Product[] = []
  const existing = [...state.products.map(p => p.internalSku)]
  const importedCustomerSkus = new Set<string>()
  for (const item of items) {
    const customerSku = (item.customerSku || item.internalSku || '').trim()
    const skuError = validateCustomerSku(customerSku)
    if (skuError) return { ok: false, error: `导入数据 SKU 无效：${skuError}` }
    const code = opts?.customerCode?.trim()
    if (!code || code === '—') return { ok: false, error: '导入前请绑定客户编码' }
    const customerId = opts?.customerId || item.customerId
    const key = normalizeSkuKey(customerSku)
    if (importedCustomerSkus.has(key) || findProductByCustomerSku(customerSku, customerId)) {
      return { ok: false, error: duplicateSkuMessage(customerSku) }
    }
    importedCustomerSkus.add(key)
    try {
      const internalSku = buildInternalSku(code, customerSku, [...existing, ...prepared.map(p => p.internalSku)])
      prepared.push({
        ...item,
        customerId,
        customerSku,
        internalSku,
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  const before = structuredClone(state)
  state.products = [...state.products, ...prepared]
  try {
    await persistLocalOrThrow()
  } catch (error) {
    state = before
    emit()
    return { ok: false, error: `导入保存失败：${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, count: prepared.length }
}

function normalizeSkuKey(sku: string) {
  return sku.trim().toLowerCase()
}

/** 按内部 SKU 查找产品（系统唯一键） */
export function findProductBySku(sku: string, excludeProductId?: string) {
  const key = normalizeSkuKey(sku)
  if (!key) return undefined
  return state.products.find(
    (p) => p.internalSku.toLowerCase() === key && (!excludeProductId || p.id !== excludeProductId),
  )
}

/** 按客户可见 SKU 查找（同一客户内唯一，忽略大小写）。 */
export function findProductByCustomerSku(customerSku: string, customerId?: string, excludeProductId?: string) {
  const key = normalizeSkuKey(customerSku)
  if (!key) return undefined
  return state.products.find(p => {
    if (excludeProductId && p.id === excludeProductId) return false
    if (customerId ? p.customerId !== customerId : Boolean(p.customerId)) return false
    const display = (p.customerSku || getCustomerSkuDisplay(p)).trim().toLowerCase()
    return display === key
  })
}

function duplicateSkuMessage(sku: string) {
  return `重复 SKU：${sku.trim()}`
}

/** OMS 建品后写入本地产品列表 */
export async function upsertLocalProduct(product: Product): Promise<{ ok: true } | { ok: false; error: string }> {
  const internalSku = product.internalSku.trim()
  if (!internalSku) return { ok: false, error: '请填写 SKU' }
  const customerSku = product.customerSku?.trim() || ''
  const skuError = validateCustomerSku(customerSku)
  if (skuError) return { ok: false, error: skuError }

  const duplicate = findProductBySku(internalSku, product.id)
  if (duplicate) {
    return { ok: false, error: duplicateSkuMessage(internalSku) }
  }
  const duplicateCustomerSku = findProductByCustomerSku(customerSku, product.customerId, product.id)
  if (duplicateCustomerSku) {
    return { ok: false, error: duplicateSkuMessage(customerSku) }
  }

  const before = structuredClone(state)
  const idx = state.products.findIndex((p) => p.id === product.id)
  const payload: Product = {
    ...product,
    internalSku,
    customerSku,
  }
  if (idx >= 0) {
    const next = [...state.products]
    next[idx] = { ...next[idx], ...payload }
    state.products = next
  } else {
    state.products = [payload, ...state.products]
  }
  try {
    await persistProductOrThrow(payload)
  } catch (error) {
    state = before
    emit()
    return { ok: false, error: `商品保存失败：${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true }
}

/** 商品列表批量维护：一次性更新并持久化，避免逐条请求覆盖。 */
export async function updateLocalProducts(
  productIds: Iterable<string>,
  buildPatch: Partial<Product> | ((product: Product) => Partial<Product>),
): Promise<number> {
  const ids = new Set(productIds)
  if (ids.size === 0) return 0
  const before = structuredClone(state)
  let count = 0
  const updated: Product[] = []
  state.products = state.products.map(product => {
    if (!ids.has(product.id)) return product
    count += 1
    const patch = typeof buildPatch === 'function' ? buildPatch(product) : buildPatch
    const next = { ...product, ...patch, id: product.id, internalSku: product.internalSku }
    updated.push(next)
    return next
  })
  if (count > 0) {
    try {
      await Promise.all(updated.map(product => persistProductOrThrow(product)))
    } catch (error) {
      state = before
      emit()
      throw error
    }
  }
  return count
}

/** 移入商品回收站；保留原状态以便恢复。 */
export async function discardLocalProduct(productId: string): Promise<boolean> {
  const product = state.products.find(item => item.id === productId)
  if (!product || product.productStatus === 'discarded') return false
  await updateLocalProducts([productId], {
    productStatus: 'discarded',
    discardedFrom: product.productStatus,
  })
  return true
}

/** 从商品回收站恢复为废弃前的状态。 */
export async function restoreLocalProduct(productId: string): Promise<boolean> {
  const product = state.products.find(item => item.id === productId)
  if (!product || product.productStatus !== 'discarded') return false
  await updateLocalProducts([productId], {
    productStatus: product.discardedFrom || 'available',
    discardedFrom: undefined,
  })
  return true
}

/** 当前 SKU 是否仍有会阻止永久删除的运营库存。 */
export function hasLocalProductStock(productId: string): boolean {
  const product = state.products.find(item => item.id === productId)
  if (!product) return false
  return state.inventory.some(item => (
    item.sku === product.internalSku
    && (item.customerId ?? null) === (product.customerId ?? null)
    && (
      item.available > 0
      || item.locked > 0
      || item.inTransit > 0
      || item.pendingShelving > 0
      || item.pendingOutbound > 0
      || item.defective > 0
    )
  ))
}

/** 永久删除已废弃商品及其同客户本地库存展示记录；历史单据不受影响。 */
export async function permanentlyDeleteLocalProduct(productId: string): Promise<boolean> {
  const product = state.products.find(item => item.id === productId)
  if (!product || product.productStatus !== 'discarded') return false
  if (hasLocalProductStock(productId)) {
    throw new Error('该 SKU 仍有库存，不能永久删除；请先清空库存')
  }

  const before = structuredClone(state)
  state.products = state.products.filter(item => item.id !== productId)
  state.inventory = state.inventory.filter(item => {
    if (item.sku !== product.internalSku) return true
    return (item.customerId ?? null) !== (product.customerId ?? null)
  })
  try {
    await apiDelete(`/inventory-state/products/${encodeURIComponent(productId)}`)
  } catch (error) {
    state = before
    emit()
    throw error
  }
  return true
}

/** 审核通过：草稿/审核中 → 可用 */
export async function approveProducts(productIds: Iterable<string>): Promise<number> {
  const ids = new Set(productIds)
  if (ids.size === 0) return 0
  const before = structuredClone(state)
  let count = 0
  state.products = state.products.map(product => {
    if (!ids.has(product.id)) return product
    if (product.productStatus !== 'draft' && product.productStatus !== 'reviewing') {
      return product
    }
    count += 1
    return { ...product, productStatus: 'available' }
  })
  if (count > 0) {
    try {
      await persistLocalOrThrow()
    } catch (error) {
      state = before
      emit()
      throw error
    }
  }
  return count
}

/** 新建产品时生成带客户代码前缀的内部 SKU */
export function prepareNewProductSkus(
  customerSku: string,
  customerCode: string,
  customerId?: string,
  excludeProductId?: string,
): { customerSku: string; internalSku: string } | { ok: false; error: string } {
  const trimmed = customerSku.trim()
  const skuError = validateCustomerSku(trimmed)
  if (skuError) return { ok: false, error: skuError }
  const code = customerCode.trim()
  if (!code || code === '—') return { ok: false, error: '当前账号未绑定客户编码' }
  if (findProductByCustomerSku(trimmed, customerId, excludeProductId)) {
    return { ok: false, error: duplicateSkuMessage(trimmed) }
  }
  try {
    const internalSku = buildInternalSku(
      code,
      trimmed,
      listInternalSkusForCustomer(state.products.filter(product => product.id !== excludeProductId), customerId),
    )
    return { customerSku: trimmed, internalSku }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
