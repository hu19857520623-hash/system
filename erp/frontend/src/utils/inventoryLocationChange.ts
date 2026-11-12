export type LocationChangeAttempt = {
  clientRequestId: string
  customerCode: string
  sku: string
  warehouseCode: string
  fromLocationCode?: string
  toLocationCode: string
  qty: number
  remark?: string
  contentChanged?: boolean
}

const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

function key(userId: number) {
  return `inventory-location-change:${userId}`
}

export function keepFailedBatchRows<T>(rows: T[], results: Array<{ line: number; ok: boolean }>): T[] {
  const failedLines = new Set(results.filter(row => !row.ok).map(row => row.line))
  return rows.filter((_, index) => failedLines.has(index + 2))
}

export type LocationBatchAttempt = {
  clientRequestId: string
  defaultWarehouse: string
  rows: unknown[]
  contentChanged?: boolean
}

function batchKey(userId: number) {
  return `inventory-location-batch:${userId}`
}

export function sameBatchRows(left: unknown[], right: unknown[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function readLocationBatchAttempt(storage: Storage, userId: number): LocationBatchAttempt | null {
  const raw = storage.getItem(batchKey(userId))
  if (!raw) return null
  const row = JSON.parse(raw) as LocationBatchAttempt
  if (!REQUEST_ID.test(row?.clientRequestId || '') || typeof row.defaultWarehouse !== 'string' || !row.defaultWarehouse || !Array.isArray(row.rows) || !row.rows.length) {
    throw new Error('原批量库存变更记录已损坏，请核对库位后重新上传')
  }
  if (row.contentChanged !== true) delete row.contentChanged
  return row
}

export function saveLocationBatchAttempt(storage: Storage, userId: number, attempt: LocationBatchAttempt) {
  const saved = storage.getItem(batchKey(userId))
  try {
    storage.setItem(batchKey(userId), JSON.stringify(attempt))
    if (storage.getItem(batchKey(userId)) !== JSON.stringify(attempt)) throw new Error('mismatch')
  } catch {
    try {
      if (saved == null) storage.removeItem(batchKey(userId))
      else storage.setItem(batchKey(userId), saved)
    } catch { /* 恢复失败时仍阻止发送请求 */ }
    throw new Error('原批量库存变更未能保存，本次未提交')
  }
}

export function clearLocationBatchAttempt(storage: Storage, userId: number, requestId: string) {
  const current = readLocationBatchAttempt(storage, userId)
  if (current?.clientRequestId === requestId) storage.removeItem(batchKey(userId))
}

export function unappliedBatchRows<T>(rows: T[], unappliedIndices: number[]): T[] {
  const keep = new Set(unappliedIndices)
  return rows.filter((_, index) => keep.has(index))
}

export function sameLocationChange(a: LocationChangeAttempt, b: LocationChangeAttempt) {
  return a.customerCode === b.customerCode
    && a.sku === b.sku
    && a.warehouseCode === b.warehouseCode
    && (a.fromLocationCode || '') === (b.fromLocationCode || '')
    && a.toLocationCode === b.toLocationCode
    && a.qty === b.qty
    && (a.remark || '') === (b.remark || '')
}

export function readLocationChangeAttempt(storage: Storage, userId: number): LocationChangeAttempt | null {
  const raw = storage.getItem(key(userId))
  if (!raw) return null
  const row = JSON.parse(raw) as LocationChangeAttempt
  if (!REQUEST_ID.test(row?.clientRequestId || '') || !row.customerCode || !row.sku || !row.warehouseCode || !row.toLocationCode || !Number.isInteger(row.qty) || row.qty < 0) {
    throw new Error('原库存变更记录已损坏，请核对库存后重新填写')
  }
  if (row.contentChanged !== true) delete row.contentChanged
  return row
}

export function saveLocationChangeAttempt(storage: Storage, userId: number, attempt: LocationChangeAttempt) {
  const saved = storage.getItem(key(userId))
  try {
    storage.setItem(key(userId), JSON.stringify(attempt))
    if (storage.getItem(key(userId)) !== JSON.stringify(attempt)) throw new Error('mismatch')
  } catch {
    try {
      if (saved == null) storage.removeItem(key(userId))
      else storage.setItem(key(userId), saved)
    } catch { /* 恢复失败时仍阻止发送请求 */ }
    throw new Error('原库存变更未能保存，本次未提交')
  }
}

export function inventoryAuthRecovery(status: number, actionName: string, continuePhrase: string): string | null {
  if (status === 401) return `登录已失效，原${actionName}已保留。请使用原账号重新登录后${continuePhrase}，不要重新填写。`
  if (status === 403) return `当前岗位无法核对原${actionName}，原请求已保留。请恢复原岗位权限后${continuePhrase}，不要更换账号重新填写。`
  if (status === 429) return `请求过于频繁，原${actionName}已保留。请稍后再${continuePhrase}，不要重新填写。`
  return null
}

export function inventoryContentMismatch(message: string) {
  return ['内容不同', '勿修改后重复提交', '勿更改、追加或重排'].some(part => message.includes(part))
}

export function inventoryRequestFinished(message: string) {
  if (inventoryContentMismatch(message)) return false
  return message.includes('原批次已结束') || message.includes('状态已变化') || message.includes('已回滚')
}

export function inventoryPendingNotice(action: string, contentChanged?: boolean) {
  if (contentChanged) return `原${action}内容不同。请先核对库存流水；若本次没有入账，结束本次后再重新填写，不要继续原请求。`
  return `原${action}结果待核对。请继续原请求，服务器会返回原回执，勿重新创建${action}。`
}

export function clearLocationChangeAttempt(storage: Storage, userId: number, requestId: string) {
  const current = readLocationChangeAttempt(storage, userId)
  if (current?.clientRequestId === requestId) storage.removeItem(key(userId))
}

export type LocationAdjustAttempt = {
  clientRequestId: string
  locationId: number
  customerCode: string
  sku: string
  warehouseCode: string
  locationCode: string
  qty: number
  remark?: string
  contentChanged?: boolean
}

function adjustKey(userId: number) {
  return `inventory-location-adjust:${userId}`
}

export function sameLocationAdjust(a: LocationAdjustAttempt, b: LocationAdjustAttempt) {
  return a.locationId === b.locationId
    && a.customerCode === b.customerCode
    && a.sku === b.sku
    && a.warehouseCode === b.warehouseCode
    && a.locationCode === b.locationCode
    && a.qty === b.qty
    && (a.remark || '') === (b.remark || '')
}

export function readLocationAdjustAttempt(storage: Storage, userId: number): LocationAdjustAttempt | null {
  const raw = storage.getItem(adjustKey(userId))
  if (!raw) return null
  const row = JSON.parse(raw) as LocationAdjustAttempt
  if (!REQUEST_ID.test(row?.clientRequestId || '') || !Number.isInteger(row.locationId) || row.locationId <= 0 || !row.customerCode || !row.sku || !row.warehouseCode || !row.locationCode || !Number.isInteger(row.qty) || row.qty < 0) {
    throw new Error('原库位调整记录已损坏，请核对库位后重新填写')
  }
  if (row.contentChanged !== true) delete row.contentChanged
  return row
}

export function saveLocationAdjustAttempt(storage: Storage, userId: number, attempt: LocationAdjustAttempt) {
  const saved = storage.getItem(adjustKey(userId))
  try {
    storage.setItem(adjustKey(userId), JSON.stringify(attempt))
    if (storage.getItem(adjustKey(userId)) !== JSON.stringify(attempt)) throw new Error('mismatch')
  } catch {
    try {
      if (saved == null) storage.removeItem(adjustKey(userId))
      else storage.setItem(adjustKey(userId), saved)
    } catch { /* 恢复失败时仍阻止发送请求 */ }
    throw new Error('原库位调整未能保存，本次未提交')
  }
}

export function clearLocationAdjustAttempt(storage: Storage, userId: number, requestId: string) {
  const current = readLocationAdjustAttempt(storage, userId)
  if (current?.clientRequestId === requestId) storage.removeItem(adjustKey(userId))
}
