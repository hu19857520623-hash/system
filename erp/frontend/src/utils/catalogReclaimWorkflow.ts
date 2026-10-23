import { userFacingError } from '@erp/shared/user-facing-error'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ReclaimAttempt = { productName: string; maxQty: number; refundLines?: Array<{orderId:number;orderNo:string;quantity:number;unitPrice:number}>; payload: { clientRequestId: string; customerCode: string; sku: string; quantity: number; remark?: string; allocations: Array<{orderId:number;quantity:number}>; expectedRefundAmount: number } }
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('请使用原账号登录后核对收回操作')
  return `erp:catalog-reclaim:${userId}`
}
function validAttempt(row: ReclaimAttempt) {
  const p=row?.payload
  return !!p && typeof row.productName==='string' && Number.isSafeInteger(row.maxQty) && row.maxQty>0 && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(p.clientRequestId) && typeof p.customerCode==='string' && !!p.customerCode && typeof p.sku==='string' && !!p.sku && Number.isSafeInteger(p.quantity) && p.quantity>0
    && typeof p.expectedRefundAmount==='number' && p.expectedRefundAmount>0 && /^\d{1,12}(\.\d{1,2})?$/.test(String(p.expectedRefundAmount)) && Array.isArray(p.allocations) && p.allocations.length>0
    && p.allocations.every(a=>Number.isSafeInteger(a.orderId)&&a.orderId>0&&Number.isSafeInteger(a.quantity)&&a.quantity>0) && p.allocations.reduce((sum,a)=>sum+a.quantity,0)===p.quantity
}
export function readReclaimAttempt(storage: StoragePort, userId: number): ReclaimAttempt | null {
  try {
    const raw = storage.getItem(key(userId));if (!raw) return null
    const row = JSON.parse(raw)
    if (!validAttempt(row)) throw new Error()
    return row
  } catch { throw new Error('原收回信息无法读取，请核对原操作记录，勿重新收回') }
}
export function saveReclaimAttempt(storage: StoragePort, userId: number, attempt: ReclaimAttempt) {
  if (!validAttempt(attempt)) throw new Error('收回退款信息不完整，本次尚未提交，请重新核对原购买记录')
  const previous = readReclaimAttempt(storage, userId)
  if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw new Error('还有原收回操作待核对，请先重试原操作，勿更改数量或重新收回')
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存收回核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export async function runReclaimAttempt(request: (body: ReclaimAttempt['payload']) => Promise<any>, storage: StoragePort, userId: number, attempt: ReclaimAttempt) {
  saveReclaimAttempt(storage, userId, attempt)
  const clear = () => { if (readReclaimAttempt(storage, userId)?.payload.clientRequestId === attempt.payload.clientRequestId) storage.removeItem(key(userId)) }
  try {
    const result = await request(attempt.payload)
    if (result.clientRequestId !== attempt.payload.clientRequestId || result.customerCode !== attempt.payload.customerCode || result.quantity !== attempt.payload.quantity || result.refundAmount !== attempt.payload.expectedRefundAmount) throw new Error('收回结果与原操作不一致，请核对原记录')
    if (result.syncPending) return { completed: false, result, message: result.warning || '收回已保存，同步待核对，请重试原操作，勿重复收回' }
    clear();return { completed: true, result, message: result.message || '收回已完成，请核对最新持有记录' }
  } catch (error) {
    const status = Number((error as {status?:unknown})?.status)
    if ([400,404,422].includes(status)) { clear();throw new Error(`${userFacingError(error)}。本次未新增收回，请重新读取持有后核对`) }
    throw new Error(`收回结果待核对，原操作已保留。请使用原账号重试原收回，勿另建操作。${userFacingError(error)}`)
  }
}

export function reclaimRequestId() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('浏览器无法生成收回请求标识，请更新浏览器后重试')
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
}
