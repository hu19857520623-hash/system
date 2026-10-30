type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ShipmentMaintenanceAttempt = { kind: 'delete' | 'freight'; inboundId: number; inboundNo: string; clear?: boolean; payload?: any; snapshot: any }
const key = (userId: number) => `erp:shipment-maintenance:${userId}`
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
