type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReceiptAttempt = { payload: { poId: number; clientRequestId: string; [key: string]: any }; target: any; lines: any[]; contentChanged?: boolean }
const key = (userId: number) => `erp:logistics-receipt-attempts:${userId}`

export async function withReceiptAttemptLock<T>(userId: number, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new Error('当前浏览器无法协调多个收货页面，本次尚未提交')
  return navigator.locks.request(key(userId), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一个页面正在处理收货，请稍后返回列表核对')
    return work()
  })
}

export function assertReceiptAcknowledgement(result: unknown, payload: ReceiptAttempt['payload']) {
  const receipt = result as { receiptNo?: unknown; poId?: unknown; clientRequestId?: unknown; poStatus?: unknown } | null
  if (!receipt || typeof receipt.receiptNo !== 'string' || !receipt.receiptNo.trim() ||
    receipt.poId !== payload.poId || receipt.clientRequestId !== payload.clientRequestId ||
    typeof receipt.poStatus !== 'string' || !receipt.poStatus.trim()) {
    throw new Error('服务器未返回与本次操作匹配的收货回执')
  }
}

export function readReceiptAttempts(storage: StoragePort, userId: number): ReceiptAttempt[] {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return []
    const attempts = JSON.parse(text)
    if (!Array.isArray(attempts) || attempts.some(attempt => !Number.isSafeInteger(attempt?.payload?.poId) || typeof attempt.payload.clientRequestId !== 'string' || attempt.target?.id !== attempt.payload.poId || !Array.isArray(attempt.lines))) throw new Error()
    return attempts.map(attempt => { if (attempt.contentChanged !== true) delete attempt.contentChanged; return attempt })
  } catch { throw new Error('上次收货核对信息无法读取，请联系管理员核对收货记录后再操作') }
}

export function saveReceiptAttempt(storage: StoragePort, userId: number, attempt: ReceiptAttempt) {
  const previous = readReceiptAttempts(storage, userId)
  const existing = previous.find(row => row.payload.poId === attempt.payload.poId)
  if (existing && existing.payload.clientRequestId !== attempt.payload.clientRequestId) {
    throw new Error('该采购单已有收货待核对，请返回列表继续原收货')
  }
  const next = previous.filter(row => row.payload.poId !== attempt.payload.poId)
  next.push(attempt)
  try { storage.setItem(key(userId), JSON.stringify(next)) }
  catch { throw new Error('无法保存收货核对信息，本次尚未提交，请检查浏览器存储后重试') }
}

export function receiptContentMismatch(message: string) {
  return ['已用于其他内容', '请勿重复入仓', '内容不同', '不要修改后'].some(part => message.includes(part))
}
export function clearReceiptAttempt(storage: StoragePort, userId: number, poId: number, clientRequestId: string) {
  const previous = readReceiptAttempts(storage, userId)
  const next = previous.filter(row => row.payload.poId !== poId || row.payload.clientRequestId !== clientRequestId)
  if (next.length === previous.length) return
  if (next.length) storage.setItem(key(userId), JSON.stringify(next))
  else storage.removeItem(key(userId))
}
