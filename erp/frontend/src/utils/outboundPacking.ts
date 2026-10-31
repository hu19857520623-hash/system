import { userFacingError } from '@erp/shared/user-facing-error'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type PackAttempt = {
  outboundId: number; outboundNo: string
  order: { id: number; outboundNo: string; status?: string; needsRelabel?: boolean; omsPreDeduct?: any; omsActualFees?: any }
  payload: { clientRequestId: string; reviewSource: 'pda' | 'pick_list'; isPalletized: boolean; palletInfo: string;
    cartons: { lengthCm: number; widthCm: number; heightCm: number; grossWeightKg: number }[] }
}
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0
const key = (actor: number) => {
  if (!positive(actor)) throw new Error('请使用原账号重新登录后核对复核打包')
  return `erp:outbound-packing:${actor}`
}
function valid(row: PackAttempt) {
  return positive(row?.outboundId) && typeof row.outboundNo === 'string' && !!row.outboundNo
    && row.order?.id === row.outboundId && row.order.outboundNo === row.outboundNo
    && typeof row.payload?.clientRequestId === 'string' && !!row.payload.clientRequestId.trim() && row.payload.clientRequestId.length <= 100
    && ['pda', 'pick_list'].includes(row.payload.reviewSource) && typeof row.payload.isPalletized === 'boolean'
    && typeof row.payload.palletInfo === 'string' && row.payload.palletInfo.length <= 500 && Array.isArray(row.payload.cartons)
    && (!row.order.omsPreDeduct || row.payload.cartons.length > 0)
    && row.payload.cartons.every(c => [c.lengthCm, c.widthCm, c.heightCm].every(n => Number.isFinite(n) && n > 0)
      && Number.isFinite(c.grossWeightKg) && c.grossWeightKg >= 0)
}
export function readPackAttempts(storage: StoragePort, actor: number): PackAttempt[] {
  try {
    const raw = storage.getItem(key(actor)), rows = raw ? JSON.parse(raw) : []
    if (!Array.isArray(rows) || !rows.every(valid) || new Set(rows.map(r => r.outboundId)).size !== rows.length) throw new Error()
    return rows
  } catch { throw new Error('原复核打包信息无法读取，请由主管核对原单和实测费用，勿重新复核打包') }
}
export function savePackAttempt(storage: StoragePort, actor: number, attempt: PackAttempt) {
  if (!valid(attempt)) throw new Error('复核打包资料不完整，本次尚未提交，请重新加载原单')
  const rows = readPackAttempts(storage, actor), original = rows.find(r => r.outboundId === attempt.outboundId)
  if (original && JSON.stringify(original) !== JSON.stringify(attempt)) throw new Error('原复核打包请求尚待核对，不能覆盖或更改实测资料')
  try {
    storage.setItem(key(actor), JSON.stringify([...rows.filter(r => r.outboundId !== attempt.outboundId), attempt]))
    assertSaved(storage, actor, attempt)
  } catch { throw new Error('无法保存原复核打包资料，本次尚未提交，请检查浏览器存储后重试') }
}
function assertSaved(storage: StoragePort, actor: number, attempt: PackAttempt) {
  if (JSON.stringify(readPackAttempts(storage, actor).find(r => r.outboundId === attempt.outboundId)) !== JSON.stringify(attempt)) {
    throw new Error('本机原复核打包信息已变化，请返回列表重新读取，勿提交其它明细')
  }
}
export async function withPackLock<T>(actor: number, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('当前浏览器无法安全保存复核打包操作，请使用支持的浏览器后继续')
  return navigator.locks.request(key(actor), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一个页面正在核对复核打包，请等待其结束后再继续')
    return work()
  })
}
export async function operatePackAttempt(api: any, storage: StoragePort, actor: number, attempt: PackAttempt,
  mode: 'retry' | 'check' | 'cancel', guard: () => void) {
  const assertCurrent = () => { guard();assertSaved(storage, actor, attempt) }
  try {
    assertCurrent()
    let receipt = mode === 'cancel'
      ? await api.cancelPackRequest(attempt.outboundId, attempt.payload.clientRequestId)
      : await api.packRequest(attempt.outboundId, attempt.payload.clientRequestId)
    assertCurrent()
    const validate = () => {
      if (receipt?.id !== attempt.outboundId || receipt?.outboundNo !== attempt.outboundNo || receipt?.requestId !== attempt.payload.clientRequestId
        || !['unknown', 'confirmed', 'cancelled'].includes(receipt?.outcome)) throw new Error('服务返回的复核打包结果无法核对')
    }
    validate()
    if (receipt.outcome === 'unknown' && mode === 'retry') {
      await api.pack(attempt.outboundId, structuredClone(attempt.payload))
      assertCurrent()
      receipt = await api.packRequest(attempt.outboundId, attempt.payload.clientRequestId)
      assertCurrent();validate()
    }
    if (receipt.outcome !== 'unknown') {
      // Do not clear on an HTTP error or a changed session. Only a bound immutable receipt resolves an attempt.
      const remaining = readPackAttempts(storage, actor).filter(r => r.outboundId !== attempt.outboundId)
      try {
        if (remaining.length) storage.setItem(key(actor), JSON.stringify(remaining));else storage.removeItem(key(actor))
      } catch { throw new Error('原复核打包结果已核对，但本机核对信息未能清除，请返回列表继续核对') }
    }
    return receipt as { outcome: 'unknown' | 'confirmed' | 'cancelled'; currentStatus: string }
  } catch (error: any) {
    const status = Number(error?.status)
    throw new Error(status === 401 ? '登录已失效，原复核打包请求已保留，请使用原账号登录后核对'
      : status === 403 ? '当前岗位无法核对复核打包，原请求已保留，请恢复原岗位权限后继续'
        : `原复核打包请求仍需核对，请保留原明细并继续查询或取消原请求。${userFacingError(error)}`)
  }
}
