import type { Product } from './mockData'
import { apiGet, apiPost } from '../api/client'
import { comparableProductMetadata } from './productSaveContract'
import { PRODUCT_ACTIONS, type ProductAction, type ProductActionItem, type ProductActionReceipt } from './productActionContract'
import { userFacingError } from '../utils/userFacingError'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ActionActor = { id: string; role: string; customerId: string | null }
export type ProductActionIntent = { action: ProductAction; products: Product[]; failures?: { sku: string; error: string }[] }
export type ProductActionAttempt = { requestId: string; userId: string; scope: string; action: ProductAction; items: ProductActionItem[]; labels: string[]; failures: { sku: string; error: string }[] }
export function productActionScope(actor: ActionActor) { return JSON.stringify([actor.role === 'sys_admin' ? 'admin' : 'customer', actor.role === 'sys_admin' ? null : actor.customerId]) }
function key(actor: ActionActor) {
  if (!actor.id || actor.role !== 'sys_admin' && !actor.customerId) throw new Error('请使用原客户账号核对商品操作')
  return `oms:product-action:${JSON.stringify([actor.id, productActionScope(actor)])}`
}
export function buildProductAction(intent: ProductActionIntent, actor: ActionActor): ProductActionAttempt {
  if (!intent.products.length || intent.products.length > 500) throw new Error('每次请选择1至500个商品操作')
  const ids = new Set<string>()
  const items = intent.products.map(row => {
    if (!row.customerId || row.inCatalog || ids.has(row.id) || actor.role !== 'sys_admin' && row.customerId !== actor.customerId) throw new Error('请选择当前客户的独立商品，不能操作共享货盘或重复记录')
    ids.add(row.id)
    return { id: row.id, customerId: row.customerId, expected: comparableProductMetadata(row) }
  })
  return { requestId: crypto.randomUUID(), userId: actor.id, scope: productActionScope(actor), action: intent.action, items, labels: intent.products.map(row => `${row.customerSku || row.internalSku} · ${row.name}`), failures: intent.failures || [] }
}
export function readProductAction(storage: StoragePort, actor: ActionActor): ProductActionAttempt | null {
  try {
    const raw = storage.getItem(key(actor)); if (!raw) return null
    const a = JSON.parse(raw) as ProductActionAttempt
    if (a.userId !== actor.id || a.scope !== productActionScope(actor) || !/^[a-f0-9-]{36}$/i.test(a.requestId) || !PRODUCT_ACTIONS.includes(a.action)
      || !Array.isArray(a.items) || !a.items.length || a.items.length > 500 || new Set(a.items.map(row => row.id)).size !== a.items.length
      || a.items.some(row => !row.id || !row.customerId || typeof row.expected !== 'string' || actor.role !== 'sys_admin' && row.customerId !== actor.customerId)
      || !Array.isArray(a.labels) || a.labels.length !== a.items.length || a.labels.some(row => typeof row !== 'string')
      || !Array.isArray(a.failures) || a.failures.some(row => typeof row.sku !== 'string' || typeof row.error !== 'string')) throw new Error()
    return a
  } catch { throw new Error('原商品操作信息无法读取，请联系管理员核对，勿重新操作') }
}
export function storeProductAction(storage: StoragePort, actor: ActionActor, a: ProductActionAttempt) {
  if (a.userId !== actor.id || a.scope !== productActionScope(actor)) throw new Error('原商品操作与当前身份不符')
  if (readProductAction(storage, actor)) throw new Error('还有原商品操作待核对，请先核对或取消原操作')
  try { const raw = JSON.stringify(a); storage.setItem(key(actor), raw); if (storage.getItem(key(actor)) !== raw) throw new Error() }
  catch { throw new Error('无法保存商品操作核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearProductAction(storage: StoragePort, actor: ActionActor, a: ProductActionAttempt) {
  const current = readProductAction(storage, actor)
  if (current && current.requestId !== a.requestId) throw new Error('商品操作已变化，请重新核对')
  try { storage.removeItem(key(actor)) } catch { throw new Error('操作已确认，但本地原操作信息未能清除，请再次核对') }
}
export function requestProductAction(mode: 'submit' | 'check' | 'cancel', a: ProductActionAttempt) {
  const path = `/inventory-products/actions/${a.requestId}`
  return mode === 'check' ? apiGet<ProductActionReceipt>(path) : apiPost<ProductActionReceipt>(path + (mode === 'cancel' ? '/cancel' : ''), { action: a.action, items: a.items })
}
export async function runProductAction(request: () => Promise<ProductActionReceipt>, a: ProductActionAttempt, owner: string, currentOwner: () => string | null) {
  try {
    if (!owner || owner !== currentOwner()) throw new Error('登录身份或商品维护权限已变化')
    const r = await request()
    if (owner !== currentOwner()) throw new Error('登录身份或商品维护权限已变化')
    if (r?.requestId !== a.requestId || !['unknown', 'confirmed', 'cancelled'].includes(r.status)) throw new Error('商品操作回执不完整')
    if (r.status !== 'unknown' && (r.action !== a.action || !Array.isArray(r.productIds))) throw new Error('商品操作回执与原操作不符')
    if (r.status === 'confirmed' && (r.productIds!.length !== a.items.length || new Set(r.productIds).size !== a.items.length || a.items.some(item => !r.productIds!.includes(item.id)))) throw new Error('商品操作回执中的商品范围不符')
    if (r.status === 'cancelled' && r.productIds!.length) throw new Error('商品取消回执不完整')
    return r
  } catch (error) { throw new Error(`原商品操作已保留，请核对结果、继续原操作或取消原操作，勿重新操作。${userFacingError(error)}`) }
}
