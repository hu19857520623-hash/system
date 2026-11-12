type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReturnProcessAttempt = {
  returnId: number
  returnNo: string
  payload: { clientRequestId: string; [key: string]: any }
  uncertain: boolean
  contentChanged: boolean
}
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录身份无效，请重新登录后核对退件处理')
  return `erp:return-process:${userId}`
}
export function readReturnProcessAttempt(storage: StoragePort, userId: number): ReturnProcessAttempt | null {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return null
    const attempt = JSON.parse(text) as ReturnProcessAttempt
    if (!Number.isSafeInteger(attempt?.returnId) || attempt.returnId <= 0 || typeof attempt.returnNo !== 'string' || typeof attempt.payload?.clientRequestId !== 'string') throw new Error()
    return attempt
  } catch {
    throw new Error('上次退件处理的核对信息无法读取，请重新读取；读成功前不要另起一次上架')
  }
}
export function saveReturnProcessAttempt(storage: StoragePort, userId: number, attempt: ReturnProcessAttempt) {
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存退件处理核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearReturnProcessAttempt(storage: StoragePort, userId: number) {
  storage.removeItem(key(userId))
}
