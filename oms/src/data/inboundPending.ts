import type { InboundOrder } from './mockData'

export type InboundOperationKind = 'create' | 'update' | 'reactivate' | 'withdraw' | 'void'
export type InboundPending = {
  version: 1
  kind: InboundOperationKind
  customerCode: string
  inboundNo: string
  body: Record<string, unknown>
  localOrder: InboundOrder
  createdAt: string
  contentChanged?: boolean
}
export class InboundPendingError extends Error { readonly status = 409 }

export type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())

function assertOriginal(value: unknown): asserts value is InboundPending {
  if (!object(value) || value.version !== 1 || !['create', 'update', 'reactivate', 'withdraw', 'void'].includes(String(value.kind))
    || !text(value.customerCode) || !text(value.inboundNo) || !object(value.body) || !object(value.localOrder)
    || !text(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new InboundPendingError()
  const body = value.body, order = value.localOrder
  if (!text(order.id) || !text(order.customerId) || order.inboundNo !== value.inboundNo
    || body.customerCode !== value.customerCode || body.customerId !== order.customerId
    || typeof body.clientRequestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.clientRequestId)) throw new InboundPendingError()
  if (value.kind !== 'create' && (typeof body.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedVersion))) throw new InboundPendingError()
  if (body.expectedVersion !== undefined && (typeof body.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedVersion))) throw new InboundPendingError()
  if (body.inboundNo !== undefined && body.inboundNo !== value.inboundNo) throw new InboundPendingError()
  if (['create', 'update', 'reactivate'].includes(String(value.kind))) {
    if (body.inboundNo !== value.inboundNo || !Array.isArray(body.items) || !body.items.length
      || body.items.some(line => !object(line) || !text(line.sku) || typeof line.qty !== 'number' || !Number.isSafeInteger(line.qty) || line.qty <= 0)) throw new InboundPendingError()
  } else if (body.items !== undefined || body.attachments !== undefined) throw new InboundPendingError()
}

export function inboundPendingKey(userId: string, customerCode: string, inboundNo: string) {
  if (!userId || !customerCode || !inboundNo) throw new InboundPendingError('登录或客户信息缺失，请重新登录后处理原入库单')
  return `oms-inbound-original-v1:${JSON.stringify([userId, customerCode, inboundNo])}`
}

export function readInboundPending(storage: PendingStorage, key: string): InboundPending | null {
  let raw: string | null
  try { raw = storage.getItem(key) } catch { throw new InboundPendingError('无法读取原入库操作，请恢复浏览器存储后核对原单') }
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    assertOriginal(value)
    if (value.contentChanged !== true) delete value.contentChanged
    return value
  } catch { throw new InboundPendingError('原入库操作记录无法读取，请保留记录并核对原单，暂不提交新操作') }
}

/** Persist and verify the original body before the first network request. */
export function saveInboundPending(storage: PendingStorage, key: string, record: InboundPending) {
  if (readInboundPending(storage, key)) throw new InboundPendingError('本单仍有待核对的原操作，请先读取或重试原请求')
  try { assertOriginal(record) }
  catch { throw new InboundPendingError('原入库请求资料不完整或与当前单据不符，本次没有发送，请重新打开原单核对') }
  const raw = JSON.stringify(record)
  try {
    storage.setItem(key, raw)
    if (storage.getItem(key) !== raw) throw new InboundPendingError()
  } catch { throw new InboundPendingError('原入库请求未能可靠保存，本次没有发送，请释放浏览器存储空间后重试') }
  return JSON.parse(raw) as InboundPending
}

export function markInboundContentChanged(storage: PendingStorage, key: string, expected: InboundPending) {
  const current = readInboundPending(storage, key)
  if (!current || current.body.clientRequestId !== expected.body.clientRequestId) throw new InboundPendingError('原入库操作记录已被其他页面更新，请重新核对')
  const next = { ...current, contentChanged: true as const }
  const raw = JSON.stringify(next)
  storage.setItem(key, raw)
  if (storage.getItem(key) !== raw) throw new InboundPendingError('原入库内容变化未能保存，请保留记录并重新核对')
  return next
}

/** A late response must never clear a newer operation from another tab. */
export function clearInboundPending(storage: PendingStorage, key: string, expected: InboundPending) {
  const current = readInboundPending(storage, key)
  if (!current) return
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new InboundPendingError('原入库操作记录已被其他页面更新，请重新核对')
  try {
    storage.removeItem(key)
    if (storage.getItem(key) !== null) throw new InboundPendingError()
  } catch { throw new InboundPendingError('原入库操作已完成，但浏览器记录未清除，请读取原单后继续核对') }
}

export async function withInboundOperationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new InboundPendingError('当前浏览器无法锁定原入库操作，请使用支持页面锁的浏览器后重试')
  return navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock) throw new InboundPendingError('其他页面正在处理本入库单，请等待原页面完成后核对')
    return action()
  })
}
