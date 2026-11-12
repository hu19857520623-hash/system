type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ShipmentMaintenanceAttempt = { kind: 'delete' | 'freight'; inboundId: number; inboundNo: string; clear?: boolean; payload?: any; snapshot: any }
const key = (userId: number) => `erp:shipment-maintenance:${userId}`
export function assertShipmentMaintenanceReceipt(attempt: ShipmentMaintenanceAttempt, result: unknown) {
  const receipt = result as { id?: unknown; inboundNo?: unknown; ok?: unknown; committed?: unknown; requestId?: unknown } | null
  if (receipt?.id !== attempt.inboundId || receipt.inboundNo !== attempt.inboundNo ||
    (attempt.kind === 'delete' ? receipt.ok !== true : receipt.committed !== true || receipt.requestId !== attempt.payload?.clientRequestId)) {
    throw new Error('发运维护回执未能匹配原操作，请保留原请求继续核对')
  }
}
export function readShipmentMaintenance(storage: StoragePort, userId: number): ShipmentMaintenanceAttempt | null {
  try {
    const text = storage.getItem(key(userId)); if (!text) return null
    const attempt = JSON.parse(text)
    if (!['delete', 'freight'].includes(attempt?.kind) || !Number.isSafeInteger(attempt.inboundId) || attempt.inboundId <= 0 || typeof attempt.inboundNo !== 'string' || !attempt.snapshot || (attempt.kind === 'freight' && typeof attempt.payload?.clientRequestId !== 'string')) throw new Error()
    return attempt
  } catch { throw new Error('上次发运维护操作的核对信息无法读取，请联系管理员核对原单和库存后再操作') }
}
export function saveShipmentMaintenance(storage: StoragePort, userId: number, attempt: ShipmentMaintenanceAttempt) {
  const previous = readShipmentMaintenance(storage, userId)
  if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw new Error('还有上次发运维护操作待核对，请先核对原操作')
  try {const raw=JSON.stringify(attempt);storage.setItem(key(userId),raw);if(storage.getItem(key(userId))!==raw)throw new Error()}
  catch { throw new Error('无法保存原操作核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearShipmentMaintenance(storage: StoragePort, userId: number, expected: ShipmentMaintenanceAttempt) {if(JSON.stringify(readShipmentMaintenance(storage,userId))!==JSON.stringify(expected))throw new Error('本地原发运维护记录已变化，请重新读取核对');storage.removeItem(key(userId)) }

export function shipmentMaintenanceFailure(status: number, message: string) {
  const mismatch = ['已用于其他内容', '请勿重复修改', '请勿重复删除', '内容不同', '不要修改'].some(part => message.includes(part))
  if (mismatch) return { clear: false, retry: false, message: `${message}。请先核对入库单和海运费，不要重试原操作。` }
  if ([400, 404, 409, 422].includes(status)) return { clear: true, retry: false, message: `${message}。请重新读取最新详情后再填写，不要重试原操作。` }
  return { clear: false, retry: true, message: `操作结果待核对，请点击「核对并重试原操作」，不要重新建立操作。${message}` }
}
