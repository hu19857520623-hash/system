import { userFacingError } from '../utils/userFacingError'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type CatalogPurchaseAttempt = { orderNo: string; customerId: string; customerCode: string; sku: string; name: string; quantity: number; unitPrice: number }
function key(userId: string, customerId: string) {
  if (!userId || !customerId) throw new Error('请使用原客户账号登录后核对采购')
  return `oms:catalog-purchase:${JSON.stringify([userId, customerId])}`
}
export function readCatalogAttempts(storage: StoragePort, userId: string, customerId: string): CatalogPurchaseAttempt[] {
  try {
    const raw = storage.getItem(key(userId, customerId));if (!raw) return []
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows) || rows.some(r => typeof r?.orderNo !== 'string' || !r.orderNo || r.customerId !== customerId || typeof r.sku !== 'string' || !Number.isSafeInteger(r.quantity) || r.quantity <= 0 || !Number.isFinite(r.unitPrice) || r.unitPrice <= 0)) throw new Error()
    return rows
  } catch { throw new Error('原采购核对信息无法读取，请联系管理员核对原采购单与余额，勿再次购买') }
}
export function saveCatalogAttempt(storage: StoragePort, userId: string, attempt: CatalogPurchaseAttempt) {
  const rows = readCatalogAttempts(storage, userId, attempt.customerId), old = rows.find(r => r.sku === attempt.sku)
  if (old && JSON.stringify(old) !== JSON.stringify(attempt)) throw new Error('此商品还有原采购待核对，请先重试原采购单，不能修改数量或报价后再次购买')
  try { storage.setItem(key(userId, attempt.customerId), JSON.stringify([...rows.filter(r => r.sku !== attempt.sku), attempt])) }
  catch { throw new Error('无法保存采购核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
function clear(storage: StoragePort, userId: string, attempt: CatalogPurchaseAttempt) {
  const rows = readCatalogAttempts(storage, userId, attempt.customerId).filter(r => r.orderNo !== attempt.orderNo)
  if (rows.length) storage.setItem(key(userId, attempt.customerId), JSON.stringify(rows));else storage.removeItem(key(userId, attempt.customerId))
}
export async function runCatalogAttempt<T extends { syncPending?: boolean; warning?: string }>(request: (body: CatalogPurchaseAttempt) => Promise<T>, storage: StoragePort, userId: string, attempt: CatalogPurchaseAttempt, apply: (result: T) => void) {
  try {
    const result = await request(attempt)
    if (result.syncPending) return { completed: false, result, message: result.warning || '采购已保存，同步待核对，请重试原采购单，勿再次购买' }
    apply(result);clear(storage, userId, attempt)
    return { completed: true, result, message: '采购已完成，余额与持有已更新' }
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status)
    if ([400, 404, 409, 422].includes(status)) {
      try { clear(storage, userId, attempt) } catch { throw new Error('原采购已返回结果，但核对信息未能清除，请联系管理员核对，勿重复购买') }
      throw new Error(`${userFacingError(error)}。本次请求未新增采购，请核对最新商品和余额后继续`)
    }
    throw new Error(status === 401 ? '登录已失效，原采购单已保留，请使用原客户账号登录后核对重试，勿再次购买'
      : status === 403 ? '当前账号无法核对原采购，原采购单已保留，请恢复原账号权限后重试，勿更换账号重新购买'
        : `采购结果尚未核实，原采购单已保留，请核对并重试原采购，勿再次购买。${userFacingError(error)}`)
  }
}
