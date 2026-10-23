import { userFacingError } from '@erp/shared/user-facing-error'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ShipAttempt = { outboundId: number; outboundNo: string; order: any; payload: { clientRequestId: string; trackingNo: string; carrier: string; logisticsProduct: string } }
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('请使用原账号重新登录后核对发运操作')
  return `erp:outbound-shipping:${userId}`
}
export function readShipAttempts(storage: StoragePort, userId: number): ShipAttempt[] {
  try {
    const value = storage.getItem(key(userId));if (!value) return []
    const rows = JSON.parse(value)
    if (!Array.isArray(rows) || rows.some(r => !Number.isSafeInteger(r?.outboundId) || r.outboundId <= 0 || typeof r.outboundNo !== 'string' || r.order?.id !== r.outboundId || typeof r.payload?.clientRequestId !== 'string')) throw new Error()
    return rows
  } catch { throw new Error('原发运操作信息无法读取，请由主管核对原单据和扣款，勿重新发运') }
}
export function saveShipAttempt(storage: StoragePort, userId: number, attempt: ShipAttempt) {
  const rows = readShipAttempts(storage, userId), previous = rows.find(r => r.outboundId === attempt.outboundId)
  if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw new Error('此单还有原发运请求待核对，请先重试原操作，勿修改后提交')
  try { storage.setItem(key(userId), JSON.stringify([...rows.filter(r => r.outboundId !== attempt.outboundId), attempt])) }
  catch { throw new Error('无法保存发运核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
function clear(storage: StoragePort, userId: number, attempt: ShipAttempt) {
  const rows = readShipAttempts(storage, userId).filter(r => r.outboundId !== attempt.outboundId || r.payload.clientRequestId !== attempt.payload.clientRequestId)
  if (rows.length) storage.setItem(key(userId), JSON.stringify(rows));else storage.removeItem(key(userId))
}
export async function runShipAttempt(api: any, storage: StoragePort, userId: number, attempt: ShipAttempt) {
  try {
    const result = await api.ship(attempt.outboundId, attempt.payload)
    if (result.feePending || result.syncPending) return { completed: false, result, message: result.warning || '发运已保存，同步待核对，请重试原操作' }
    clear(storage, userId, attempt)
    return { completed: true, result, message: result.message || '发运与扣费已保存，请查看最新结果' }
  } catch (error: any) {
    const status = Number(error?.status)
    if ([400, 404, 409, 422].includes(status)) {
      try { clear(storage, userId, attempt) } catch { throw new Error('原请求已返回结果，但本机核对信息未清除，请由主管核对，勿重复发运') }
      throw new Error(`${userFacingError(error)}。请返回列表核对最新单据后继续`)
    }
    throw new Error(status === 401 ? '登录已失效，原发运请求已保留。请使用原账号登录后核对重试，勿重新发运'
      : status === 403 ? '当前岗位无法核对原发运操作，原请求已保留。请恢复原岗位权限后重试，勿更换账号再次发运'
        : `发运结果尚未核实，原请求已保留，请重试原操作，勿重新发运或扣款。${userFacingError(error)}`)
  }
}
