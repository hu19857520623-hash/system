import { useSyncExternalStore } from 'react'
import { apiPut } from '../api/client'
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
} from './skuCode'

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

function persistLocal() {
  emit()
  void apiPut('/inventory-state', state).catch(err => console.error('persist inventory failed', err))
}

async function persistLocalOrThrow() {
  emit()
  await apiPut('/inventory-state', state)
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

/** 客户申购货盘商品：本地演示逻辑（无 ERP 时回退） */
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
      ean: pool?.ean,
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
  emit()
  try {
    await persistLocalOrThrow()
  } catch (error) {
    state = before
    emit()
    throw error
  }
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
      const item = state.inventory.find(
        i => i.sku === line.sku && i.stockSource === 'catalog' && i.customerId === customerId,
      )
      if (!item) {
        return { ok: false, error: `${line.sku} 尚未申购，请先在货盘选品申购并锁定库存` }
      }
      if (item.locked < qty) {
        return { ok: false, error: `${line.sku} 锁定库存不足（需 ${qty}，已锁定 ${item.locked}）` }
      }
      continue
    }
    const item = state.inventory.find(
      i => i.sku === line.sku && i.stockSource === 'owned' && (!i.customerId || i.customerId === customerId),
    )
    if (!item) return { ok: false, error: `未找到 SKU ${line.sku} 的自有库存` }
    if (item.available < qty) {
      return { ok: false, error: `${line.sku} 可售库存不足（需 ${qty}，可售 ${item.available}）` }
    }
  }

  for (const line of lines) {
    const qty = line.qty
    if (qty <= 0) continue
    const product = state.products.find(p => p.internalSku === line.sku)
    const item = state.inventory.find(i =>
      i.sku === line.sku &&
      i.stockSource === stockSource &&
      (stockSource === 'catalog' ? i.customerId === customerId : (!i.customerId || i.customerId === customerId)),
    )!
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
    const product = state.products.find(p => p.internalSku === line.sku)
    if (stockSource === 'catalog') {
      const item = state.inventory.find(
        i => i.sku === line.sku && i.stockSource === 'catalog' && i.customerId === customerId,
      )
      if (!item) continue
      item.locked += qty
      item.pendingOutbound = Math.max(0, item.pendingOutbound - qty)
      if (product) product.lockedQty += qty
      continue
    }
    const item = state.inventory.find(
      i => i.sku === line.sku && i.stockSource === 'owned' && (!i.customerId || i.customerId === customerId),
    )
    if (!item) continue
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

export function getProductsSnapshot(): Product[] {
  return state.products
}

export function getInventorySnapshot(): InventoryItem[] {
  return state.inventory
}

/** P1：用 ERP 客户库存视图刷新货盘持有展示 */
export async function refreshInventoryFromErp(customerId: string, customerCode: string): Promise<number> {
  const { syncErpInventoryView } = await import('../api/erp')
  const data = await syncErpInventoryView(customerCode)
  for (const item of data.items || []) {
    const idx = state.inventory.findIndex(
      i => i.sku === item.sku && i.stockSource === 'catalog' && i.customerId === customerId,
    )
    if (idx >= 0) {
      state.inventory[idx].locked = item.quantity
      state.inventory[idx].available = item.warehouseAvailable
      state.inventory[idx].name = item.productName
      state.inventory[idx].price = item.unitPrice ?? state.inventory[idx].price
      state.inventory[idx].warehouse = item.warehouseCode
    } else {
      const safeSku = item.sku.replace(/[^A-Za-z0-9_-]/g, '_')
      state.inventory.unshift({
        id: `erp-inv-${customerId}-${item.id}-${safeSku}`,
        customerId,
        sku: item.sku,
        name: item.productName,
        image: '',
        available: item.warehouseAvailable,
        locked: item.quantity,
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
        stockSource: 'catalog',
      })
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
  for (const item of items) {
    const customerSku = (item.customerSku || item.internalSku || '').trim()
    if (!customerSku) return { ok: false, error: '导入数据缺少 SKU' }
    const code = opts?.customerCode?.trim()
    if (!code || code === '—') return { ok: false, error: '导入前请绑定客户编码' }
    try {
      const internalSku = buildInternalSku(code, customerSku, [...existing, ...prepared.map(p => p.internalSku)])
      prepared.push({
        ...item,
        customerId: opts?.customerId || item.customerId,
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

/** 按客户可见 SKU 查找（可重复时返回首个匹配） */
export function findProductByCustomerSku(customerSku: string, customerId?: string, excludeProductId?: string) {
  const key = normalizeSkuKey(customerSku)
  if (!key) return undefined
  return state.products.find(p => {
    if (excludeProductId && p.id === excludeProductId) return false
    if (customerId && p.customerId && p.customerId !== customerId) return false
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
  if (!product.customerSku?.trim()) return { ok: false, error: '请填写 SKU' }

  const duplicate = findProductBySku(internalSku, product.id)
  if (duplicate) {
    return { ok: false, error: duplicateSkuMessage(internalSku) }
  }

  const before = structuredClone(state)
  const idx = state.products.findIndex((p) => p.id === product.id)
  const payload: Product = {
    ...product,
    internalSku,
    customerSku: product.customerSku.trim(),
  }
  if (idx >= 0) {
    const next = [...state.products]
    next[idx] = { ...next[idx], ...payload }
    state.products = next
  } else {
    state.products = [payload, ...state.products]
  }
  try {
    await persistLocalOrThrow()
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
  state.products = state.products.map(product => {
    if (!ids.has(product.id)) return product
    count += 1
    const patch = typeof buildPatch === 'function' ? buildPatch(product) : buildPatch
    return { ...product, ...patch, id: product.id, internalSku: product.internalSku }
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
): { customerSku: string; internalSku: string } | { ok: false; error: string } {
  const trimmed = customerSku.trim()
  if (!trimmed) return { ok: false, error: '请填写 SKU' }
  const code = customerCode.trim()
  if (!code || code === '—') return { ok: false, error: '当前账号未绑定客户编码' }
  try {
    const internalSku = buildInternalSku(
      code,
      trimmed,
      listInternalSkusForCustomer(state.products, customerId),
    )
    return { customerSku: trimmed, internalSku }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
