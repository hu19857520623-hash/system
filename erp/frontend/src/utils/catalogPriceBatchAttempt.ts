import { priceTiers, type Prices } from './catalogPriceImport'
export type BatchPayload = { requestId: string; remark: string; rows: Array<{ id: number; prices: Prices; expectedPrices: Prices }> }
const validId = (v: unknown) => typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
export function readPriceBatchAttempt(storage: Pick<Storage,'getItem'>, key: string): BatchPayload | null {
  const text=storage.getItem(key)
  if(!text)return null
  const p=JSON.parse(text)
  if(!validId(p?.requestId) || typeof p.remark!=='string' || !p.remark.trim() || !Array.isArray(p.rows) || !p.rows.length || p.rows.length>500 || p.rows.some((r: any)=>!Number.isSafeInteger(r?.id) || r.id<=0 || ['prices','expectedPrices'].some(k=>!r[k] || priceTiers.some(t=>r[k][t]!==null && (typeof r[k][t]!=='number' || !Number.isFinite(r[k][t]))))))throw Error('原批次资料无法读取，请联系管理员核对，不能创建新批次覆盖')
  return p
}
export function assertPriceBatchReceipt(value: any, attempt: BatchPayload) {
  if(!value || value.requestId!==attempt.requestId || !['applied','cancelled','unknown'].includes(value.status))throw Error('批次回执不完整，请继续核对原批次')
  if(value.status==='applied' && (value.total!==attempt.rows.length || !Number.isSafeInteger(value.changed) || value.changed<0 || !Number.isSafeInteger(value.unchanged) || value.unchanged<0 || value.changed+value.unchanged!==value.total))throw Error('批次保存数量与原请求不一致，请核对原批次')
  return value as { requestId: string; status: 'applied'|'cancelled'|'unknown'; total?: number; changed?: number; unchanged?: number }
}
