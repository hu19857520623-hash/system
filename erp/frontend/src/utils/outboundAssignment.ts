import { userFacingError } from '@erp/shared/user-facing-error'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type AssignmentAttempt = { pickerName: string; orderNos: string[]; payload: { clientRequestId: string; ids: number[]; pickerId: number; expectedOrders: { id: number; status: string; pickerId: number | null }[] } }
const positive = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0
const key = (actor: number) => {
  if (!positive(actor)) throw new Error('请使用原账号重新登录后核对分配')
  return `erp:outbound-assignment:${actor}`
}
function valid(row: AssignmentAttempt) {
  const p = row?.payload
  return typeof row?.pickerName === 'string' && !!row.pickerName && Array.isArray(row.orderNos) && row.orderNos.length === p?.ids?.length
    && row.orderNos.every(n => typeof n === 'string' && !!n) && /^\S(?:.{0,98}\S)?$/.test(p?.clientRequestId || '') && positive(p.pickerId)
    && Array.isArray(p.ids) && p.ids.length > 0 && p.ids.every(positive) && new Set(p.ids).size === p.ids.length
    && Array.isArray(p.expectedOrders) && p.expectedOrders.length === p.ids.length && new Set(p.expectedOrders.map(r => r.id)).size === p.ids.length
    && p.expectedOrders.every(r => p.ids.includes(r.id) && ['pending_pick', 'picking'].includes(r.status) && (r.pickerId === null || positive(r.pickerId)))
}
export function readAssignment(storage: StoragePort, actor: number): AssignmentAttempt | null {
  try { const raw = storage.getItem(key(actor));if (!raw) return null;const row = JSON.parse(raw);if (!valid(row)) throw new Error();return row }
  catch { throw new Error('原分配资料无法读取，请由主管核对原批次和人员，勿再次分配') }
}
function assertSaved(storage: StoragePort, actor: number, attempt: AssignmentAttempt) {
  if (JSON.stringify(readAssignment(storage, actor)) !== JSON.stringify(attempt)) throw new Error('本机原分配资料已变化，请返回列表重新读取')
}
export function saveAssignment(storage: StoragePort, actor: number, attempt: AssignmentAttempt) {
  if (!valid(attempt)) throw new Error('原分配资料不完整，本次尚未提交')
  const previous = readAssignment(storage, actor)
  if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw new Error('还有原分配请求待核对，不能另建或覆盖原批次')
  try { storage.setItem(key(actor), JSON.stringify(attempt));assertSaved(storage, actor, attempt) }
  catch { throw new Error('无法保存原分配资料，本次尚未提交，请检查浏览器存储后重试') }
}
export async function withAssignmentLock<T>(actor: number, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('当前浏览器无法安全保存原分配请求，请使用支持的浏览器')
  return navigator.locks.request(key(actor), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一个页面正在处理原分配请求，请等待其结束')
    return work()
  })
}
export async function operateAssignment(api: any, storage: StoragePort, actor: number, attempt: AssignmentAttempt, mode: 'retry' | 'check' | 'cancel', guard: () => void) {
  const assertCurrent = () => { guard();assertSaved(storage, actor, attempt) }
  try {
    assertCurrent()
    let receipt = mode === 'cancel' ? await api.cancelAssignment(JSON.parse(JSON.stringify(attempt.payload))) : await api.assignmentRequest(attempt.payload.clientRequestId)
    assertCurrent()
    const validate = () => {
      if (receipt?.requestId !== attempt.payload.clientRequestId || !['unknown', 'confirmed', 'cancelled'].includes(receipt?.outcome)) throw new Error('服务返回的原分配结果无法核对')
      if (receipt.outcome !== 'unknown' && (receipt.pickerId !== attempt.payload.pickerId || !Array.isArray(receipt.ids)
        || JSON.stringify([...receipt.ids].sort((a,b)=>a-b)) !== JSON.stringify([...attempt.payload.ids].sort((a,b)=>a-b)))) throw new Error('服务返回的分配批次或人员无法核对')
    }
    validate()
    if (receipt.outcome === 'unknown' && mode === 'retry') {
      await api.assignPicker(JSON.parse(JSON.stringify(attempt.payload)));assertCurrent()
      receipt = await api.assignmentRequest(attempt.payload.clientRequestId);assertCurrent();validate()
    }
    if (receipt.outcome !== 'unknown') {
      try { storage.removeItem(key(actor)) } catch { throw new Error('原结果已核对，但本机原分配资料未能清除，请继续查询原结果') }
    }
    return receipt as { outcome: 'unknown' | 'confirmed' | 'cancelled'; orders: { id: number; outboundNo: string; status: string; pickerId: number | null }[] }
  } catch (e: any) {
    throw new Error(Number(e?.status) === 401 ? '登录已失效，原分配请求已保留，请使用原账号登录后核对'
      : Number(e?.status) === 403 ? '当前岗位无法核对分配，原请求已保留，请恢复原岗位权限后继续'
        : `原分配请求仍需核对，请继续查询原结果、重试原批次或取消原请求。${userFacingError(e)}`)
  }
}
