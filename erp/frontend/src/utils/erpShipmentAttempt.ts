type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ShipmentAttempt = { payload: { clientRequestId: string; [key: string]: any }; form: any; draftNo: string | null }
const key = (userId: number) => `erp:shipment-attempt:${userId}`

export function readShipmentAttempt(storage: StoragePort, userId: number): ShipmentAttempt | null {
  try {
    const text = storage.getItem(key(userId))
    if (!text) return null
    const attempt = JSON.parse(text)
    if (!attempt || typeof attempt.payload?.clientRequestId !== 'string' || !Array.isArray(attempt.payload.items) || !attempt.form || !Array.isArray(attempt.form.lines)) throw new Error()
    return attempt
  } catch { throw new Error('上次发运核对信息无法读取，请联系管理员核对入库单后再操作') }
}

export function saveShipmentAttempt(storage: StoragePort, userId: number, attempt: ShipmentAttempt) {
  const previous = readShipmentAttempt(storage, userId)
  if (previous && previous.payload.clientRequestId !== attempt.payload.clientRequestId) throw new Error('还有上次发运结果待核对，请先使用原操作重试')
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存发运核对信息，本次尚未提交，请检查浏览器存储后重试') }
}

export function clearShipmentAttempt(storage: StoragePort, userId: number) {
  storage.removeItem(key(userId))
}
