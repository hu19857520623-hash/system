import type { Product } from './mockData'
import { apiGet, apiPost } from '../api/client'
import type { ProductSaveReceipt } from './productSaveContract'
import { userFacingError } from '../utils/userFacingError'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ProductSaveAttempt = { requestId: string; userId: string; customerId: string; mode: 'create' | 'update'; action: 'draft' | 'submit' | 'update'; expected: string | null; product: Product }
function key(user: string, customer: string) {
  if (!user || !customer) throw new Error('请使用原账号核对商品保存结果')
  return `oms:product-save:${JSON.stringify([user, customer])}`
}
export function readProductSaveAttempt(storage: StoragePort, user: string, customer: string): ProductSaveAttempt | null {
  try {
    const raw = storage.getItem(key(user, customer)); if (!raw) return null
    const a = JSON.parse(raw) as ProductSaveAttempt
    if (a.userId !== user || a.customerId !== customer || !/^[a-f0-9-]{36}$/i.test(a.requestId) || !a.product?.id || a.product.customerId !== customer
      || !['create', 'update'].includes(a.mode) || !['draft', 'submit', 'update'].includes(a.action) || (a.mode === 'create' ? a.expected !== null : typeof a.expected !== 'string')) throw new Error()
    return a
  } catch { throw new Error('原商品保存信息无法读取，请联系管理员核对，勿重复创建或保存') }
}
export function storeProductSaveAttempt(storage: StoragePort, a: ProductSaveAttempt) {
  if (readProductSaveAttempt(storage, a.userId, a.customerId)) throw new Error('还有原商品保存请求待核对，请先核对或取消原请求')
  try {
    const raw = JSON.stringify(a); storage.setItem(key(a.userId, a.customerId), raw)
    if (storage.getItem(key(a.userId, a.customerId)) !== raw) throw new Error()
  } catch { throw new Error('无法保存商品核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearProductSaveAttempt(storage: StoragePort, a: ProductSaveAttempt) {
  const current = readProductSaveAttempt(storage, a.userId, a.customerId)
  if (current && current.requestId !== a.requestId) throw new Error('原商品保存请求已变化，请重新核对')
  try { storage.removeItem(key(a.userId, a.customerId)) }
  catch { throw new Error('保存结果已确认，但本地核对信息未清除，请继续核对原请求') }
}
export function requestProductSave(mode: 'submit' | 'check' | 'cancel', a: ProductSaveAttempt) {
  const path = `/inventory-products/saves/${encodeURIComponent(a.customerId)}/${a.requestId}`
  return mode === 'check' ? apiGet<ProductSaveReceipt>(path)
    : apiPost<ProductSaveReceipt>(path + (mode === 'cancel' ? '/cancel' : ''), mode === 'cancel' ? {} : { product: a.product, expected: a.expected, mode: a.mode })
}
export async function runProductSaveAttempt(request: () => Promise<ProductSaveReceipt>, a: ProductSaveAttempt, owner: string, currentOwner: () => string | null) {
  try {
    if (!owner || owner !== currentOwner()) throw new Error('登录身份或商品维护权限已变化')
    const result = await request()
    if (owner !== currentOwner()) throw new Error('登录身份或商品维护权限已变化')
    if (result?.requestId !== a.requestId || !['unknown', 'confirmed', 'cancelled'].includes(result.status)
      || (result.status === 'confirmed' && result.productId !== a.product.id) || (result.status === 'cancelled' && result.productId !== null)) throw new Error('商品保存回执与原请求不符')
    return result
  } catch (error) { throw new Error(`原商品保存请求已保留，请核对原结果、继续原保存或取消原请求。${userFacingError(error)}`) }
}
