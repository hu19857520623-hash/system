type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReturnDisposeAttempt = {
  id: number
  returnNo: string
  payload: { clientRequestId: string; processRemark: string }
  contentChanged: boolean
}
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录身份无效，请重新登录后核对退件销毁')
  return `erp:return-dispose:${userId}`
}
export function readReturnDisposeAttempt(storage: StoragePort, userId: number): ReturnDisposeAttempt | null {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return null
    const attempt = JSON.parse(text) as ReturnDisposeAttempt
    if (!Number.isSafeInteger(attempt?.id) || attempt.id <= 0 || typeof attempt.returnNo !== 'string' || typeof attempt.payload?.clientRequestId !== 'string') throw new Error()
    return attempt
  } catch {
    throw new Error('上次退件销毁的核对信息无法读取，请重新读取；读成功前不要另起一次销毁')
  }
}
export function saveReturnDisposeAttempt(storage: StoragePort, userId: number, attempt: ReturnDisposeAttempt) {
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存退件销毁核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearReturnDisposeAttempt(storage: StoragePort, userId: number) {
  storage.removeItem(key(userId))
}
