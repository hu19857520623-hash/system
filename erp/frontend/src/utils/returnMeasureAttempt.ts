type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReturnMeasureCarton = { lengthCm: number; widthCm: number; heightCm: number; grossWeightKg: number }
export type ReturnMeasureAttempt = {
  returnId: number
  returnNo: string
  measurePayload: { clientRequestId: string; cartons: ReturnMeasureCarton[] }
  feePayload: { clientRequestId: string }
  feeSent: boolean
  uncertain: boolean
  contentChanged: boolean
}
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录身份无效，请重新登录后核对退件测量')
  return `erp:return-measure:${userId}`
}
function validCarton(row: ReturnMeasureCarton) {
  return [row?.lengthCm, row?.widthCm, row?.heightCm, row?.grossWeightKg].every(value => Number.isFinite(Number(value)))
}
export function readReturnMeasureAttempt(storage: StoragePort, userId: number): ReturnMeasureAttempt | null {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return null
    const attempt = JSON.parse(text) as ReturnMeasureAttempt
    if (!Number.isSafeInteger(attempt?.returnId) || attempt.returnId <= 0 || typeof attempt.returnNo !== 'string' || typeof attempt.measurePayload?.clientRequestId !== 'string' || typeof attempt.feePayload?.clientRequestId !== 'string' || !Array.isArray(attempt.measurePayload.cartons) || !attempt.measurePayload.cartons.length || attempt.measurePayload.cartons.some(row => !validCarton(row))) throw new Error()
    return attempt
  } catch {
    throw new Error('上次退件测量的核对信息无法读取，请重新读取；读成功前不要另起一次测量')
  }
}
export function saveReturnMeasureAttempt(storage: StoragePort, userId: number, attempt: ReturnMeasureAttempt) {
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存退件测量核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearReturnMeasureAttempt(storage: StoragePort, userId: number) {
  storage.removeItem(key(userId))
}
