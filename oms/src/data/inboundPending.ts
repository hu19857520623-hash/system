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
}
export class InboundPendingError extends Error { readonly status = 409 }

export type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function inboundPendingKey(userId: string, customerCode: string, inboundNo: string) {
  if (!userId || !customerCode || !inboundNo) throw new InboundPendingError('登录或客户信息缺失，请重新登录后处理原入库单')
  return `oms-inbound-original-v1:${JSON.stringify([userId, customerCode, inboundNo])}`
}

export function readInboundPending(storage: PendingStorage, key: string): InboundPending | null {
  let raw: string | null
  try { raw = storage.getItem(key) } catch { throw new InboundPendingError('无法读取原入库操作，请恢复浏览器存储后核对原单') }
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as InboundPending
    if (value.version !== 1 || !['create', 'update', 'reactivate', 'withdraw', 'void'].includes(value.kind)
      || !value.customerCode || !value.inboundNo || !value.localOrder || typeof value.body !== 'object' || !value.body) throw new InboundPendingError()
    return value
  } catch { throw new InboundPendingError('原入库操作记录无法读取，请保留记录并核对原单，暂不提交新操作') }
}

/** Persist and verify the original body before the first network request. */
export function saveInboundPending(storage: PendingStorage, key: string, record: InboundPending) {
  if (readInboundPending(storage, key)) throw new InboundPendingError('本单仍有待核对的原操作，请先读取或重试原请求')
  const raw = JSON.stringify(record)
  try {
    storage.setItem(key, raw)
    if (storage.getItem(key) !== raw) throw new InboundPendingError()
  } catch { throw new InboundPendingError('原入库请求未能可靠保存，本次没有发送，请释放浏览器存储空间后重试') }
  return JSON.parse(raw) as InboundPending
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
