import { useSyncExternalStore } from 'react'
import { apiDelete, apiPut, authSessionScope, getStoredAuthSession } from '../api/client'
import { userFacingError } from '../utils/userFacingError'
import { purchaseErpCatalog, type ErpCatalogItem, type ErpPurchaseResult } from '../api/erp'
import type { InventoryItem, Product } from './mockData'
import { getCustomerCode } from './dataScope'
import { getFeeRecords, hydrateBilling } from './billingStore'
import { readCatalogAttempts, saveCatalogAttempt, runCatalogAttempt, type CatalogPurchaseAttempt } from './catalogPurchaseWorkflow'
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

function sessionOwner() { return authSessionScope() }
let hydrationVersion = 0, inventoryRefreshVersion = 0
const productDeleteVersions = new Map<string, number>()
function mayRestore(owner: string, generation: number) { return owner === sessionOwner() && generation === hydrationVersion }

async function persistLocalOrThrow() {
  throw new Error('库存由ERP维护，请通过出库单作业或同步ERP继续，不能直接修改库存数量')
}

async function persistProductsOrThrow(products: Product[]) {
  const owner = sessionOwner(), generation = hydrationVersion
  const deleteVersions = products.map(product => productDeleteVersions.get(product.id) || 0)
  const payload = products.map(product => {
    const { availableQty: _available, lockedQty: _locked, inCatalog: _catalog, ...metadata } = product
    return metadata
  })
  const result = await apiPut<{ ok: boolean; products: Product[] }>('/inventory-products', { products: payload })
  if (!mayRestore(owner, generation)) throw new Error('登录身份或商品页面已变化，请重新打开商品核对保存结果')
  if (products.some((product, index) => (productDeleteVersions.get(product.id) || 0) !== deleteVersions[index])) throw new Error('商品已删除，旧保存结果已忽略，请刷新商品列表核对')
  if (!result.ok || !Array.isArray(result.products) || result.products.length !== products.length) throw new Error('商品可能已保存，但返回记录不完整，请刷新商品列表核对后继续')
  const saved = new Map(result.products.map(product => [product.id, product]))
  if (saved.size !== products.length || products.some(product => !saved.has(product.id) || saved.get(product.id)?.customerId !== product.customerId)) throw new Error('商品返回内容与所选记录不同，请刷新后核对')
  const existingIds = new Set(state.products.map(product => product.id))
  state.products = state.products.map(product => saved.has(product.id) ? { ...product, ...saved.get(product.id) } : product)
  state.products.push(...result.products.filter(product => !existingIds.has(product.id)))
  emit()
}

async function persistProductOrThrow(product: Product) { await persistProductsOrThrow([product]) }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function hydrateInventory(next: HydrateInventoryInput) {
  ++hydrationVersion; ++inventoryRefreshVersion
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

export type LockStockResult = { ok: true; purchase: CatalogPurchase } | { ok: false; error: string; uncertain?: boolean }

/** Local-only purchases cannot reserve stock or bypass the ERP payment workflow. */
export function purchaseCatalogProduct(_internalSku: string, _qty: number, _customerId: string): LockStockResult {
  return { ok: false, error: '请连接ERP后在货盘选品中申购，不能离线修改持有库存' }
}

function applyErpPurchaseLocally(
  result: ErpPurchaseResult,
  customerId: string,
  productName: string,
) {
  const product = state.products.find(p => p.internalSku === result.sku)
  if (product) {
    product.availableQty = result.remainingStockQty
    product.lockedQty = result.soldQty
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
    if (result.inventoryMirrorId) state.inventory[custIdx].id = result.inventoryMirrorId
    state.inventory[custIdx].locked = result.holdingQuantity
    state.inventory[custIdx].price = result.unitPrice
  } else if (result.holdingQuantity > 0) {
    const pool = poolIdx >= 0 ? state.inventory[poolIdx] : undefined
    state.inventory.push({
      id: result.inventoryMirrorId!,
      customerId,
      sku: result.sku,
      name: productName || pool?.name || result.sku,
      image: pool?.image || product?.image || '',
      available: 0,
      locked: result.holdingQuantity,
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
  hydrateBilling({ creditBalance: result.currentBalance, feeRecords: getFeeRecords() })
  emit()
  return purchase
}

export function getPendingCatalogPurchases(customerId: string): CatalogPurchaseAttempt[] {
  const user = getStoredAuthSession()?.user
  if (!user || user.customerId !== customerId) throw new Error('请使用原客户账号登录后核对采购')
  return readCatalogAttempts(localStorage, user.id, customerId)
}

/** Persist the original purchase number before sending; unknown outcomes must use that same request. */
export async function purchaseCatalogProductViaErp(internalSku: string, qty: number, customerId: string, quotedUnitPrice?: number): Promise<LockStockResult> {
  const user = getStoredAuthSession()?.user
  const customerCode = getCustomerCode(customerId)
  if (!user || user.customerId !== customerId || !customerCode || customerCode === '—') return { ok: false, error: '请使用已绑定的客户账号申购' }
  if (!Number.isSafeInteger(qty) || qty <= 0) return { ok: false, error: '申购数量须为正整数' }
  try {
    const previous = getPendingCatalogPurchases(customerId).find(row => row.sku === internalSku)
    const price = quotedUnitPrice ?? state.products.find(p => p.internalSku === internalSku)?.price
    if (!price || !Number.isFinite(price) || price <= 0) return { ok: false, error: '商品报价无效，请刷新货盘后核对' }
    if (previous && (previous.quantity !== qty || previous.unitPrice !== price)) return { ok: false, uncertain: true, error: '此商品还有原采购待核对，请使用原数量和报价继续核对，勿再次购买' }
    const attempt = previous || { orderNo: `CAT-${crypto.randomUUID()}`, customerId, customerCode, sku: internalSku, quantity: qty, unitPrice: price, name: state.products.find(p => p.internalSku === internalSku)?.name || internalSku }
    if (!previous) saveCatalogAttempt(localStorage, user.id, attempt)
    let purchase: CatalogPurchase | undefined
    const response = await runCatalogAttempt(body => purchaseErpCatalog({ orderNo: body.orderNo, customerId: body.customerId, customerCode: body.customerCode, sku: body.sku, quantity: body.quantity, unitPrice: body.unitPrice }), localStorage, user.id, attempt, result => {
      if (getStoredAuthSession()?.user.id !== user.id || getStoredAuthSession()?.user.customerId !== customerId) throw new Error('客户登录身份已变化，请使用原账号核对原采购，勿再次购买')
      if (result.orderNo !== attempt.orderNo || result.sku !== attempt.sku || result.quantity !== attempt.quantity || result.customerCode !== attempt.customerCode || result.unitPrice !== attempt.unitPrice) throw new Error('采购返回内容与原清单不同，请核对原采购，勿再次购买')
      if (!Number.isFinite(result.currentBalance) || !Number.isSafeInteger(result.holdingQuantity) || result.holdingQuantity < 0) throw new Error('采购已保存，但最新余额或持有未能核对')
      if (result.holdingQuantity > 0 && (!result.inventoryMirrorId || result.inventoryMirrorId.length > 50)) throw new Error('采购已保存，但持有记录标识未能核对，请使用原采购单重试')
      purchase = applyErpPurchaseLocally(result, customerId, attempt.name)
    })
    if (!response.completed || !purchase) return { ok: false, uncertain: true, error: response.message }
    return { ok: true, purchase }
  } catch (err) {
    let uncertain = true
    try { uncertain = getPendingCatalogPurchases(customerId).some(row => row.sku === internalSku) } catch { /* Keep unresolved stored operations protected. */ }
    return { ok: false, uncertain, error: userFacingError(err) }
  }
}

/** ERP is authoritative: refresh the in-memory catalog pool without saving a customer inventory snapshot. */
export async function mergeErpCatalogIntoState(items: ErpCatalogItem[]) {
  const existingSkus = listInternalSkusForCustomer(state.products, CATALOG_CUSTOMER_ID)
  for (const item of items) {
    const internalSku = item.sku.trim()
    const customerSku = getCustomerSkuDisplay({ internalSku, customerSku: undefined }, CATALOG_CUSTOMER_CODE)
    const existing = state.products.find(
      p => (isCatalogPoolCustomerId(p.customerId) || (!p.customerId && p.inCatalog))
        && (p.internalSku === internalSku || p.customerSku === customerSku),
    )
    if (existing) {
      existing.customerId = CATALOG_CUSTOMER_ID
      existing.internalSku = internalSku
      existing.customerSku = customerSku
      existing.name = item.productName || existing.name
      existing.image = item.imageUrl || ''
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
        image: item.imageUrl || '',
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
      state.inventory[poolIdx].image = item.imageUrl || ''
      state.inventory[poolIdx].price = item.price
      state.inventory[poolIdx].spec = item.spec || state.inventory[poolIdx].spec
    } else {
      state.inventory.unshift({
        id: `erp-pool-${internalSku}`,
        customerId: CATALOG_CUSTOMER_ID,
        sku: internalSku,
        name: item.productName,
        image: item.imageUrl || '',
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

/** Legacy callers must use the ERP outbound workflow; browser snapshots cannot reserve stock. */
export async function lockStockForOutbound(
  _lines: { sku: string; qty: number }[],
  _stockSource: 'owned' | 'catalog',
  _customerId?: string,
): Promise<LockStockResult | { ok: true }> {
  return { ok: false, error: '请在出库单中提交发货，库存锁定由ERP处理；请刷新库存后继续' }
}

export async function rollbackStockForOutbound(
  _lines: { sku: string; qty: number }[],
  _stockSource: 'owned' | 'catalog',
  _customerId?: string,
) {
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
  const owner = sessionOwner(), generation = hydrationVersion, version = ++inventoryRefreshVersion
  const { syncErpInventoryView } = await import('../api/erp')
  try {
    const result = await syncErpInventoryView(customerCode)
    if (!mayRestore(owner, generation) || version !== inventoryRefreshVersion) throw new Error('登录身份或库存页面已变化，请重新查询当前客户库存')
    if (!Array.isArray(result.inventory) || !Array.isArray(result.products) || result.inventory.some(row => row.customerId !== customerId) || result.products.some(row => row.customerId !== customerId)) throw new Error('库存同步返回范围不完整，请重新查询核对')
    state.inventory = [...state.inventory.filter(row => row.customerId !== customerId), ...result.inventory]
    const products = new Map(result.products.map(product => [product.id, product]))
    state.products = state.products.map(product => {
      const canonical = products.get(product.id)
      return canonical ? { ...product, availableQty: canonical.availableQty, lockedQty: canonical.lockedQty } : product
    })
    emit()
    return result.total
  } catch (error) { throw new Error(`同步ERP未完成，请保留当前库存后重试。${userFacingError(error)}`) }
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
  try {
    await persistProductsOrThrow(prepared)
  } catch (error) {
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

/** 客户 SKU 全局唯一，忽略大小写；不按客户归属过滤。 */
export function findProductByCustomerSku(customerSku: string, _customerId?: string, excludeProductId?: string) {
  const key = normalizeSkuKey(customerSku)
  if (!key) return undefined
  return state.products.find(p => {
    if (excludeProductId && p.id === excludeProductId) return false
    const display = (p.customerSku || getCustomerSkuDisplay(p)).trim().toLowerCase()
    return display === key || p.internalSku.trim().toLowerCase() === key
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

  const payload: Product = {
    ...product,
    internalSku,
    customerSku,
  }
  try {
    await persistProductOrThrow(payload)
  } catch (error) {
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
  let count = 0
  const updated: Product[] = []
  state.products.forEach(product => {
    if (!ids.has(product.id)) return
    count += 1
    const patch = typeof buildPatch === 'function' ? buildPatch(product) : buildPatch
    const next = { ...product, ...patch, id: product.id, internalSku: product.internalSku }
    updated.push(next)
  })
  if (count > 0) {
    await persistProductsOrThrow(updated)
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
  if (product.availableQty > 0 || product.lockedQty > 0) return true
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

  const owner = sessionOwner(), generation = hydrationVersion
  try {
    await apiDelete(`/inventory-state/products/${encodeURIComponent(productId)}`)
  } catch (error) {
    // A retry after a lost successful response may find the card already gone.
    if ((error as { status?: number }).status !== 404 || !(error instanceof Error) || error.message !== '商品已删除或不存在，请刷新商品列表核对') throw error
  }
  if (!mayRestore(owner, generation)) throw new Error('商品已删除，但登录身份或页面已变化，请重新查询当前商品列表')
  productDeleteVersions.set(productId, (productDeleteVersions.get(productId) || 0) + 1)
  state.products = state.products.filter(item => item.id !== productId)
  state.inventory = state.inventory.filter(item => (
    item.stockSource !== 'owned' || item.sku !== product.internalSku || (item.customerId ?? null) !== (product.customerId ?? null)
  ))
  emit()
  return true
}

/** 审核通过：草稿/审核中 → 可用 */
export async function approveProducts(productIds: Iterable<string>): Promise<number> {
  const ids = new Set(productIds)
  if (ids.size === 0) return 0
  const selected = state.products.filter(product => ids.has(product.id) && ['draft', 'reviewing'].includes(product.productStatus))
  if (selected.length) await persistProductsOrThrow(selected.map(product => ({ ...product, productStatus: 'available' })))
  return selected.length
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
