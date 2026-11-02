import { apiGet, apiPost, apiPut, authSessionScope, getStoredAuthSession } from '../api/client'
import { can } from '../auth/permissions'
import type { InboundOrder } from './mockData'

export type InboundSaveAttempt = { version: 1; userId: string; customerId: string; requestId: string; createdAt: string; orders: (InboundOrder & { saveRequestId: string })[] }
export type InboundSaveReceipt = { requestId: string; status: 'confirmed' | 'cancelled' | 'unknown'; identities: { id: string; inboundNo: string; omsRevision: string }[]; replay?: boolean }
const failure = (message: string, status = 409) => Object.assign(new Error(message), { status })
export const inboundSaveKey = (user: string, customer: string) => `oms-inbound-save-v1:${JSON.stringify([user, customer])}`
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
export function readInboundSave(storage: Pick<Storage, 'getItem'>, user: string, customer: string): InboundSaveAttempt | null {
  let raw: string | null
  try { raw = storage.getItem(inboundSaveKey(user, customer)) } catch { throw failure('无法读取原草稿保存记录，请恢复浏览器存储后核对') }
  if (!raw) return null
  try {
    const a = JSON.parse(raw) as InboundSaveAttempt
    if (a.version !== 1 || a.userId !== user || a.customerId !== customer || !uuid(a.requestId) || !Number.isFinite(Date.parse(a.createdAt)) || !Array.isArray(a.orders) || !a.orders.length
      || a.orders.some(order => !order || order.customerId !== customer || typeof order.id !== 'string' || !order.id || typeof order.inboundNo !== 'string' || !order.inboundNo || order.saveRequestId !== a.requestId || (order.omsRevision !== undefined && !/^[a-f0-9]{64}$/.test(order.omsRevision)))) throw Error()
    return a
  } catch { throw failure('原草稿保存记录无法读取，请保留记录并核对，暂不发送新保存请求') }
}
export function storeInboundSave(storage: Pick<Storage, 'getItem' | 'setItem'>, a: InboundSaveAttempt) {
  if (readInboundSave(storage, a.userId, a.customerId)) throw failure('本客户还有原草稿保存待核对，请先处理原保存请求')
  const raw = JSON.stringify(a)
  try { storage.setItem(inboundSaveKey(a.userId, a.customerId), raw); if (storage.getItem(inboundSaveKey(a.userId, a.customerId)) !== raw) throw Error() }
  catch { throw failure('原草稿请求未能可靠保存，本次没有发送，请释放浏览器存储空间后继续') }
}
export function clearInboundSave(storage: Pick<Storage, 'getItem' | 'removeItem'>, a: InboundSaveAttempt) {
  const old = readInboundSave(storage, a.userId, a.customerId)
  if (!old) return
  if (JSON.stringify(old) !== JSON.stringify(a)) throw failure('原草稿保存记录已被其他页面改变，请重新核对')
  try { storage.removeItem(inboundSaveKey(a.userId, a.customerId)); if (storage.getItem(inboundSaveKey(a.userId, a.customerId))) throw Error() }
  catch { throw failure('结果已确认，但原保存记录未清除，请继续核对原请求') }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('oms-inbound-save-change'))
}
export function captureInboundSaveAccess(customer: string, write: boolean) {
  const session = getStoredAuthSession(), scope = authSessionScope()
  const valid = () => {
    const current = getStoredAuthSession()
    if (!session || !current || authSessionScope() !== scope || (current.user.role !== 'sys_admin' && current.user.customerId !== customer)
      || !can(current.user.role, write ? 'inbound:write' : 'inbound:read', current.user.permissions)) throw failure('当前登录或入库权限已变化，请返回原账号核对保存结果', 403)
  }
  valid();return { userId: session!.user.id, assert: valid }
}
export async function withInboundSaveLock<T>(user: string, customer: string, work: () => Promise<T>) {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw failure('当前浏览器不支持安全的草稿保存锁，请使用受支持的浏览器后继续')
  return navigator.locks.request(inboundSaveKey(user, customer), { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock) throw failure('另一页面正在处理本客户草稿，请等待原操作完成后核对')
    return work()
  })
}
export async function requestInboundSave(a: InboundSaveAttempt, action: 'submit' | 'check' | 'cancel') {
  const access = captureInboundSaveAccess(a.customerId, action !== 'check')
  if (access.userId !== a.userId) throw failure('请使用原保存账号核对草稿', 403)
  const reply = action === 'submit' ? await apiPut<InboundSaveReceipt>('/inbound-orders', a.orders)
    : await apiPost<InboundSaveReceipt>(`/inbound-orders/saves/${encodeURIComponent(a.customerId)}/${a.requestId}/${action}`, a.orders)
  access.assert()
  if (reply.requestId !== a.requestId || !['confirmed', 'cancelled', 'unknown'].includes(reply.status) || !Array.isArray(reply.identities)
    || (reply.status === 'confirmed' && (reply.identities.length !== a.orders.length || a.orders.some(order => !reply.identities.some(row => row.inboundNo === order.inboundNo && row.id && /^[a-f0-9]{64}$/.test(row.omsRevision)))))) throw failure('草稿保存回执与原请求不符，请保留原请求并核对')
  return reply
}
export async function saveInboundBatch(orders: InboundOrder[]) {
  const customer = orders[0]?.customerId
  if (!customer || orders.some(order => order.customerId !== customer)) throw failure('每批保存必须属于同一个客户，请分客户保存', 400)
  const access = captureInboundSaveAccess(customer, true)
  return withInboundSaveLock(access.userId, customer, async () => {
    access.assert()
    const old = readInboundSave(localStorage, access.userId, customer), requestId = old?.requestId || crypto.randomUUID()
    const attempt: InboundSaveAttempt = old || { version: 1, userId: access.userId, customerId: customer, requestId, createdAt: new Date().toISOString(), orders: orders.map(order => ({ ...order, saveRequestId: requestId })) }
    if (old && JSON.stringify(old.orders) !== JSON.stringify(orders.map(order => ({ ...order, saveRequestId: requestId })))) throw failure('原草稿保存内容仍待核对，请先核对或取消原保存；本次未发送新内容')
    if (!old) storeInboundSave(localStorage, attempt)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('oms-inbound-save-change'))
    // Keep the exact attempt on every rejection/timeout. Even a 409 must be fenced
    // before a new request; it may be a late response to an earlier completed send.
    const result = await requestInboundSave(attempt, 'submit')
    if (result.status !== 'confirmed') throw failure('原保存已取消，请从原保存恢复入口核对后重新打开记录')
    const currentOrders: InboundOrder[] = []
    if (result.replay) for (const order of attempt.orders) {
      const row = await apiGet<InboundOrder>(`/inbound-orders/by-no/${encodeURIComponent(order.inboundNo)}`)
      access.assert()
      if (row.customerId !== customer || row.inboundNo !== order.inboundNo || !row.omsRevision) throw failure('原保存已确认，但最新记录无法核对，请保留原请求')
      currentOrders.push(row)
    }
    clearInboundSave(localStorage, attempt)
    return { ...result, currentOrders }
  })
}
