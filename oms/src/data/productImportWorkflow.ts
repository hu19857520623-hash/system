import type { Product } from './mockData'
import type { ParsedProductImport, ParseResult } from './importTemplates'
import type { ImportRowFailure } from '../utils/importFailureDetail'
import { buildInternalSku, getCustomerSkuDisplay } from './skuCode'
import { PRODUCT_IMPORT_LIMIT, validateImportedProduct } from './productImportContract'
import { userFacingError } from '../utils/userFacingError'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ProductImportAttempt = {
  requestId: string; userId: string; customerId: string; products: Product[]; failures: ImportRowFailure[]; rowCount: number
}
export type ProductImportReceipt = { requestId: string; status: 'unknown' | 'confirmed' | 'cancelled'; count?: number; productIds?: string[] }
function key(userId: string, customerId: string) {
  if (!userId || !customerId) throw new Error('请使用原客户账号核对导入批次')
  return `oms:product-import:${JSON.stringify([userId, customerId])}`
}
export function prepareProductImport(result: ParseResult<ParsedProductImport>, existing: Product[], customerId: string, customerCode: string) {
  const lineNos = new Set([...result.data.map(row => row.sourceLineNo), ...result.failures.map(row => row.lineNo)])
  if (lineNos.size > PRODUCT_IMPORT_LIMIT) throw new Error(`本次文件有${lineNos.size}条商品，单次最多导入${PRODUCT_IMPORT_LIMIT}条。本次尚未提交，请拆分文件后重新选择`)
  if (!customerId || !customerCode || customerCode === '—') throw new Error('导入前请绑定客户编码')
  const products: Product[] = [], failures = [...result.failures]
  const keys = new Set(existing.flatMap(row => [row.internalSku, getCustomerSkuDisplay(row)]).map(value => value.trim().toLowerCase()))
  const skus = existing.map(row => row.internalSku)
  for (const { sourceLineNo, ...row } of result.data) {
    const sku = (row.customerSku || row.internalSku).trim(), normalized = sku.toLowerCase()
    let reason = validateImportedProduct(row as unknown as Record<string, unknown>)
    if (keys.has(normalized)) reason = `SKU重复：${sku}`
    if (!reason) {
      try {
        const internalSku = buildInternalSku(customerCode, sku, skus)
        products.push({ ...row, internalSku, customerSku: sku, customerId, productStatus: 'draft', productSource: 'import', availableQty: 0, lockedQty: 0, inCatalog: false })
        skus.push(internalSku); keys.add(normalized)
      } catch (error) { reason = userFacingError(error) }
    }
    if (reason) failures.push({ lineNo: sourceLineNo, sku, reason })
  }
  return { products, failures, rowCount: lineNos.size }
}
export function readProductImportAttempt(storage: StoragePort, userId: string, customerId: string): ProductImportAttempt | null {
  try {
    const raw = storage.getItem(key(userId, customerId)); if (!raw) return null
    const attempt = JSON.parse(raw) as ProductImportAttempt
    if (attempt.userId !== userId || attempt.customerId !== customerId || !/^[a-f0-9-]{36}$/i.test(attempt.requestId)
      || !Array.isArray(attempt.products) || !attempt.products.length || attempt.products.length > PRODUCT_IMPORT_LIMIT
      || attempt.products.some(row => row.customerId !== customerId || !row.id || validateImportedProduct(row as unknown as Record<string, unknown>))
      || !Array.isArray(attempt.failures) || attempt.failures.some(row => !Number.isInteger(row.lineNo) || typeof row.reason !== 'string')
      || !Number.isInteger(attempt.rowCount) || attempt.rowCount < attempt.products.length || attempt.rowCount > PRODUCT_IMPORT_LIMIT) throw new Error()
    return attempt
  } catch { throw new Error('原导入批次无法读取，请联系管理员核对原批次，勿重新导入') }
}
export function saveProductImportAttempt(storage: StoragePort, attempt: ProductImportAttempt) {
  if (readProductImportAttempt(storage, attempt.userId, attempt.customerId)) throw new Error('还有原导入批次待核对，请先核对或取消原批次')
  try {
    storage.setItem(key(attempt.userId, attempt.customerId), JSON.stringify(attempt))
    if (storage.getItem(key(attempt.userId, attempt.customerId)) !== JSON.stringify(attempt)) throw new Error()
  } catch { throw new Error('无法保存导入核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearProductImportAttempt(storage: StoragePort, attempt: ProductImportAttempt) {
  const current = readProductImportAttempt(storage, attempt.userId, attempt.customerId)
  if (current && current.requestId !== attempt.requestId) throw new Error('导入批次已变化，请重新核对')
  try { storage.removeItem(key(attempt.userId, attempt.customerId)) }
  catch { throw new Error('导入结果已确认，但本地批次未能清除，请保留原批次再次核对') }
}
export async function runProductImportAttempt(
  request: () => Promise<ProductImportReceipt>, attempt: ProductImportAttempt, owner: string, currentOwner: () => string | null,
) {
  try {
    if (!owner || owner !== currentOwner()) throw new Error('登录身份或商品维护权限已变化')
    const result = await request()
    if (owner !== currentOwner()) throw new Error('登录身份或商品维护权限已变化')
    if (result?.requestId !== attempt.requestId || !['unknown', 'confirmed', 'cancelled'].includes(result.status)) throw new Error('导入回执不完整')
    if (result.status === 'confirmed' && (result.count !== attempt.products.length || !Array.isArray(result.productIds)
      || result.productIds.length !== result.count || new Set(result.productIds).size !== result.count
      || attempt.products.some(row => !result.productIds!.includes(row.id)))) throw new Error('导入回执与原批次不同')
    if (result.status === 'cancelled' && (result.count !== 0 || result.productIds?.length !== 0)) throw new Error('取消回执不完整')
    return result
  } catch (error) {
    throw new Error(`原导入批次已保留，请核对结果或继续原批次，勿重新选择相同文件。${userFacingError(error)}`)
  }
}
