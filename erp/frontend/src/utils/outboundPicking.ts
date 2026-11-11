import { userFacingError } from '@erp/shared/user-facing-error'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type PickAttempt = {
  outboundId: number; outboundNo: string
  labels?: Record<string, string>
  order: { id: number; outboundNo: string; status?: string; pickerId?: number | null }
  payload: { clientRequestId: string; pickSource: 'pda' | 'pick_list'; items: { id: number; allocations: { locationCode: string; qty: number }[] }[] }
}
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0
const key = (actor: number) => {
  if (!positive(actor)) throw new Error('请使用原账号重新登录后核对拣货')
  return `erp:outbound-picking:${actor}`
}
function valid(row: PickAttempt) {
  return positive(row?.outboundId) && typeof row.outboundNo === 'string' && !!row.outboundNo
    && row.order?.id === row.outboundId && row.order.outboundNo === row.outboundNo
    && typeof row.payload?.clientRequestId === 'string' && !!row.payload.clientRequestId.trim() && row.payload.clientRequestId.length <= 100
    && ['pda', 'pick_list'].includes(row.payload.pickSource) && Array.isArray(row.payload.items) && row.payload.items.length > 0
    && new Set(row.payload.items.map(i => i.id)).size === row.payload.items.length
    && row.payload.items.every(i => positive(i.id) && Array.isArray(i.allocations) && i.allocations.length > 0
      && i.allocations.every(a => typeof a.locationCode === 'string' && !!a.locationCode.trim() && positive(a.qty)))
}
export function readPickAttempts(storage: StoragePort, actor: number): PickAttempt[] {
  try {
    const raw = storage.getItem(key(actor)), rows = raw ? JSON.parse(raw) : []
    if (!Array.isArray(rows) || !rows.every(valid) || new Set(rows.map(r => r.outboundId)).size !== rows.length) throw new Error()
    return rows
  } catch { throw new Error('原拣货信息无法读取，请由主管核对原单和库位扣减，勿重新拣货') }
}
export function savePickAttempt(storage: StoragePort, actor: number, attempt: PickAttempt) {
  if (!valid(attempt)) throw new Error('拣货资料不完整，本次尚未提交，请重新加载原单')
  const rows = readPickAttempts(storage, actor), original = rows.find(r => r.outboundId === attempt.outboundId)
  if (original && JSON.stringify(original) !== JSON.stringify(attempt)) throw new Error('原拣货请求尚待核对，不能覆盖或更改明细')
  try {
    storage.setItem(key(actor), JSON.stringify([...rows.filter(r => r.outboundId !== attempt.outboundId), attempt]))
    assertSaved(storage, actor, attempt)
  } catch { throw new Error('无法保存原拣货资料，本次尚未提交，请检查浏览器存储后重试') }
}
function assertSaved(storage: StoragePort, actor: number, attempt: PickAttempt) {
  if (JSON.stringify(readPickAttempts(storage, actor).find(r => r.outboundId === attempt.outboundId)) !== JSON.stringify(attempt)) {
    throw new Error('本机原拣货信息已变化，请返回列表重新读取，勿提交其它明细')
  }
}
export async function withPickLock<T>(actor: number, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('当前浏览器无法安全保存拣货操作，请使用支持的浏览器后继续')
  return navigator.locks.request(key(actor), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一个页面正在核对拣货，请等待其结束后再继续')
    return work()
  })
}
export async function operatePickAttempt(api: any, storage: StoragePort, actor: number, attempt: PickAttempt,
  mode: 'retry' | 'check' | 'cancel', guard: () => void) {
  const assertCurrent = () => { guard();assertSaved(storage, actor, attempt) }
  try {
    assertCurrent()
    let receipt = mode === 'cancel'
      ? await api.cancelPickRequest(attempt.outboundId, attempt.payload.clientRequestId)
      : await api.pickRequest(attempt.outboundId, attempt.payload.clientRequestId)
    assertCurrent()
    const validate = () => {
      if (receipt?.id !== attempt.outboundId || receipt?.outboundNo !== attempt.outboundNo || receipt?.requestId !== attempt.payload.clientRequestId
        || !['unknown', 'confirmed', 'cancelled'].includes(receipt?.outcome)) throw new Error('服务返回的拣货结果无法核对')
    }
    validate()
    if (receipt.outcome === 'unknown' && mode === 'retry') {
      await api.pick(attempt.outboundId, JSON.parse(JSON.stringify(attempt.payload)))
      assertCurrent()
      receipt = await api.pickRequest(attempt.outboundId, attempt.payload.clientRequestId)
      assertCurrent();validate()
    }
    if (receipt.outcome !== 'unknown') {
      // Do not clear on an HTTP error or a changed session. Only a bound immutable receipt resolves an attempt.
      const remaining = readPickAttempts(storage, actor).filter(r => r.outboundId !== attempt.outboundId)
      try {
        if (remaining.length) storage.setItem(key(actor), JSON.stringify(remaining));else storage.removeItem(key(actor))
      } catch { throw new Error('原拣货结果已核对，但本机核对信息未能清除，请返回列表继续核对') }
    }
    return receipt as { outcome: 'unknown' | 'confirmed' | 'cancelled'; currentStatus: string }
  } catch (error: any) {
    const status = Number(error?.status)
    throw new Error(status === 401 ? '登录已失效，原拣货请求已保留，请使用原账号登录后核对'
      : status === 403 ? '当前岗位无法核对拣货，原请求已保留，请恢复原岗位权限后继续'
        : `原拣货请求仍需核对，请保留原明细并继续查询或取消原请求。${userFacingError(error)}`)
  }
}
