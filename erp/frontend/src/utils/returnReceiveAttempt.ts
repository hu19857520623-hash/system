type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReturnReceiveAttempt = {
  action: 'receive' | 'reReceive'
  returnId: number
  returnNo: string
  payload: { clientRequestId: string; receivedQty: number; receivedCartonCount: number; remark?: string }
  uncertain: boolean
  contentChanged: boolean
}
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录身份无效，请重新登录后核对退件收货')
  return `erp:return-receive:${userId}`
}
export function readReturnReceiveAttempt(storage: StoragePort, userId: number): ReturnReceiveAttempt | null {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return null
    const attempt = JSON.parse(text) as ReturnReceiveAttempt
    if (!['receive', 'reReceive'].includes(attempt?.action) || !Number.isSafeInteger(attempt.returnId) || attempt.returnId <= 0 || typeof attempt.returnNo !== 'string' || typeof attempt.payload?.clientRequestId !== 'string' || !Number.isFinite(Number(attempt.payload.receivedQty)) || !Number.isFinite(Number(attempt.payload.receivedCartonCount))) throw new Error()
    return attempt
  } catch {
    throw new Error('上次退件收货的核对信息无法读取，请重新读取；读成功前不要另起一次收货')
  }
}
export function saveReturnReceiveAttempt(storage: StoragePort, userId: number, attempt: ReturnReceiveAttempt) {
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存退件收货核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearReturnReceiveAttempt(storage: StoragePort, userId: number) {
  storage.removeItem(key(userId))
}
