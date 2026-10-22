import { receiveInboundManually } from './manual-inbound-receive'
import type { WarehouseControlKind } from './warehouseControl'
import { userFacingError } from '@erp/shared/user-facing-error'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type WarehouseOperation = 'carton-count' | 'carton-scan' | 'qc-scan' | 'qc-submit' | 'qc-measure-submit' | 'measure' | 'putaway' | WarehouseControlKind
export type WarehouseAttempt = { kind: WarehouseOperation; inboundId: number; inboundNo: string; warehouseCode: string; payload: { clientRequestId: string; [key: string]: any }; snapshot: { order: any; [key: string]: any } }
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('登录身份无效，请重新登录后核对仓库作业')
  return `erp:warehouse-operations:${userId}`
}
const kinds = ['carton-count', 'carton-scan', 'qc-scan', 'qc-submit', 'qc-measure-submit', 'measure', 'putaway', 'resolve-exception', 'reopen-count', 'close-zero', 'reduce-qc', 'reduce-carton', 'reduce-putaway']
export function readWarehouseAttempts(storage: StoragePort, userId: number): WarehouseAttempt[] {
  try {
    const raw = storage.getItem(key(userId)); if (!raw) return []
    const attempts = JSON.parse(raw)
    if (!Array.isArray(attempts) || attempts.some(attempt => !kinds.includes(attempt?.kind) || !Number.isSafeInteger(attempt.inboundId) || attempt.inboundId <= 0 || typeof attempt.inboundNo !== 'string' || typeof attempt.warehouseCode !== 'string' || typeof attempt.payload?.clientRequestId !== 'string' || Number(attempt.snapshot?.order?.id) !== attempt.inboundId)) throw new Error()
    return attempts
  } catch { throw new Error('上次仓库作业的核对信息无法读取，请联系主管核对单据后再操作') }
}
export function saveWarehouseAttempt(storage: StoragePort, userId: number, attempt: WarehouseAttempt) {
  const previous = readWarehouseAttempts(storage, userId), other = previous.find(row => row.inboundId === attempt.inboundId)
  if (other && (other.kind !== attempt.kind || other.payload.clientRequestId !== attempt.payload.clientRequestId || JSON.stringify(other.payload) !== JSON.stringify(attempt.payload))) throw new Error('该入库单还有原操作待核对，请先使用原操作重试')
  try { storage.setItem(key(userId), JSON.stringify([...previous.filter(row => row.inboundId !== attempt.inboundId), attempt])) }
  catch { throw new Error('无法保存仓库作业核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export function clearWarehouseAttempt(storage: StoragePort, userId: number, attempt: WarehouseAttempt) {
  const remaining = readWarehouseAttempts(storage, userId).filter(row => row.inboundId !== attempt.inboundId || row.payload.clientRequestId !== attempt.payload.clientRequestId)
  if (remaining.length) storage.setItem(key(userId), JSON.stringify(remaining))
  else storage.removeItem(key(userId))
}
/** A failed retry is not proof that an earlier request was rejected. Auth failures must keep its receipt. */
export function recoverWarehouseAttemptFailure(storage: StoragePort, userId: number, attempt: WarehouseAttempt, error: any) {
  const status = Number(error?.status), detail = userFacingError(error)
  if ([400, 404, 409, 422].includes(status)) {
    try { clearWarehouseAttempt(storage, userId, attempt) }
    catch { return { retained: true, message: `${detail}；原操作核对信息未能清除，请先核对原操作，勿重新建立操作` } }
    return { retained: false, message: `${detail}。请重新读取最新单据后继续` }
  }
  if (status === 401) return { retained: true, message: '登录已失效，原操作仍已保留。请使用原账号重新登录，再核对并重试原操作，不要重新建立操作' }
  if (status === 403) return { retained: true, message: '当前岗位无法核对原操作，原请求仍已保留。请联系管理员恢复原岗位权限后重试；勿更换账号重新提交或重复更正库存' }
  return { retained: true, message: `操作结果尚未核实，请使用原操作重试，勿重新建立操作。${detail}` }
}
export async function runWarehouseAttempt(api: any, attempt: WarehouseAttempt) {
  const { inboundId: id, payload } = attempt
  if (attempt.kind === 'carton-count') return receiveInboundManually(api, id, { count: payload.receivedCartonCount, differenceReason: payload.differenceReason || '', clientRequestId: payload.clientRequestId, replay: true })
  if (attempt.kind === 'carton-scan') return api.receiveBox(id, payload)
  if (attempt.kind === 'qc-scan') return api.scanQc(id, payload)
  if (attempt.kind === 'qc-submit') return api.qc(id, payload)
  if (attempt.kind === 'qc-measure-submit') return api.qcAndMeasure(id, payload)
  if (attempt.kind === 'putaway') return api.putaway(id, payload)
  if (attempt.kind === 'resolve-exception') return api.resolveException(id, payload)
  if (attempt.kind === 'reopen-count') return api.reopenCount(id, payload)
  if (attempt.kind === 'close-zero') return api.closeZero(id, payload)
  if (attempt.kind === 'reduce-qc') return api.reduceQc(id, payload)
  if (attempt.kind === 'reduce-carton') return api.reduceCarton(id, payload)
  if (attempt.kind === 'reduce-putaway') return api.reducePutaway(id, payload)
  return api.measureDimensions(id, payload)
}
