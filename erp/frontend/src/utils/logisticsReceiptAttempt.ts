type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReceiptAttempt = { payload: { poId: number; clientRequestId: string; [key: string]: any }; target: any; lines: any[] }
const key = (userId: number) => `erp:logistics-receipt-attempts:${userId}`

export function readReceiptAttempts(storage: StoragePort, userId: number): ReceiptAttempt[] {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return []
    const attempts = JSON.parse(text)
    if (!Array.isArray(attempts) || attempts.some(attempt => !Number.isSafeInteger(attempt?.payload?.poId) || typeof attempt.payload.clientRequestId !== 'string' || attempt.target?.id !== attempt.payload.poId || !Array.isArray(attempt.lines))) throw new Error()
    return attempts
  } catch { throw new Error('上次收货核对信息无法读取，请联系管理员核对收货记录后再操作') }
}

export function saveReceiptAttempt(storage: StoragePort, userId: number, attempt: ReceiptAttempt) {
  const previous = readReceiptAttempts(storage, userId)
  const next = previous.filter(row => row.payload.poId !== attempt.payload.poId)
  next.push(attempt)
  try { storage.setItem(key(userId), JSON.stringify(next)) }
  catch { throw new Error('无法保存收货核对信息，本次尚未提交，请检查浏览器存储后重试') }
}

export function clearReceiptAttempt(storage: StoragePort, userId: number, poId: number) {
  const next = readReceiptAttempts(storage, userId).filter(row => row.payload.poId !== poId)
  if (next.length) storage.setItem(key(userId), JSON.stringify(next))
  else storage.removeItem(key(userId))
}
