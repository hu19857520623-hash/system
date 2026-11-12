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
  if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw new Error('还有上次发运结果待核对，请先使用原操作重试')
  try { const raw=JSON.stringify(attempt);storage.setItem(key(userId),raw);if(storage.getItem(key(userId))!==raw)throw new Error() }
  catch { throw new Error('无法保存发运核对信息，本次尚未提交，请检查浏览器存储后重试') }
}

export function clearShipmentAttempt(storage: StoragePort, userId: number, expected: ShipmentAttempt) {
  if(JSON.stringify(readShipmentAttempt(storage,userId))!==JSON.stringify(expected))throw new Error('本地原发运记录已变化，请重新读取核对')
  storage.removeItem(key(userId))
}

export function attachmentUploadFailure(status: number, message: string) {
  if (message.includes('回执与原文件不一致') || message.includes('与原请求不一致')) {
    return { clear: false, retry: false, message: `${message}。请先核对草稿附件，不要继续原上传。` }
  }
  if ([400, 404, 413, 422].includes(status)) return { clear: true, retry: false, message }
  return { clear: false, retry: true, message: `附件上传结果待核对，可继续原上传。${message}` }
}
export function draftAlreadyShipped(message: string) {
  return message.includes('已转为正式入库单') || message.includes('请勿重复保存发运')
}
export function shipmentSubmitFailure(status: number, message: string) {
  const mismatch = ['已用于其他内容', '请勿重复发运', '请勿重复提交', '内容不同', '不要修改'].some(part => message.includes(part))
  if (mismatch) return { clear: false, retry: false, message: `${message}。请先核对入库单，不要重试原提交。` }
  if ([400, 404, 422].includes(status)) return { clear: true, retry: false, message: `${message}。请重新读取后再填写，不要重试原提交。` }
  return { clear: false, retry: true, message: `发运结果待核对，请保持本次内容并点击「核对并重试原提交」。${message}` }
}
