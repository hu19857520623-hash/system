type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReturnInspectAttempt = {
  returnId: number
  returnNo: string
  payload: {
    clientRequestId: string
    inspectionResult: string
    inspectionRemark?: string
    attachments: Array<{ fileName: string; contentBase64: string }>
  }
  uncertain: boolean
  contentChanged: boolean
}
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录身份无效，请重新登录后核对退件质检')
  return `erp:return-inspect:${userId}`
}
export function readReturnInspectAttempt(storage: StoragePort, userId: number): ReturnInspectAttempt | null {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return null
    const attempt = JSON.parse(text) as ReturnInspectAttempt
    if (!Number.isSafeInteger(attempt?.returnId) || attempt.returnId <= 0 || typeof attempt.returnNo !== 'string' || typeof attempt.payload?.clientRequestId !== 'string' || typeof attempt.payload.inspectionResult !== 'string' || !Array.isArray(attempt.payload.attachments)) throw new Error()
    return attempt
  } catch {
    throw new Error('上次退件质检的核对信息无法读取，请重新读取；读成功前不要另起一次质检')
  }
}
export function saveReturnInspectAttempt(storage: StoragePort, userId: number, attempt: ReturnInspectAttempt) {
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存退件质检核对信息。照片可能过大，请减少照片后重试；本次尚未提交') }
}
export function clearReturnInspectAttempt(storage: StoragePort, userId: number) {
  storage.removeItem(key(userId))
}
