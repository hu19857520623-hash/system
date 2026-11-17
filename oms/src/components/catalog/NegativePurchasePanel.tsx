import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui'
import { cancelNegativePurchase, getNegativePurchases, submitNegativePurchase, type NegativePurchase } from '../../api/erp'
import type { CatalogPurchase } from '../../data/inventoryStore'
import { userFacingError } from '../../utils/userFacingError'

type Attempt = { requestId: string; orderNo: string; quantity: number; reason: string }
export default function NegativePurchasePanel({ purchases, customerCode, writable }: { purchases: CatalogPurchase[]; customerCode: string; writable: boolean }) {
  const [rows, setRows] = useState<NegativePurchase[]>([])
  const [orderNo, setOrderNo] = useState(''), [quantity, setQuantity] = useState('1'), [reason, setReason] = useState('')
  const [attempt, setAttempt] = useState<Attempt | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [storageError, setStorageError] = useState('')
  const lock = useRef(false), storageKey = `oms.negative-purchase.${customerCode}`
  async function load() {
    setError('')
    try { setRows(await getNegativePurchases()) } catch (e) { setError(userFacingError(e)) }
  }
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) { const a = JSON.parse(saved) as Attempt; if (!a || typeof a.requestId !== 'string' || typeof a.orderNo !== 'string' || !Number.isSafeInteger(a.quantity) || a.quantity <= 0 || typeof a.reason !== 'string') throw Error('invalid attempt');setAttempt(a);setOrderNo(a.orderNo);setQuantity(String(a.quantity));setReason(a.reason) }
    } catch { setStorageError('原退回申请无法读取，请联系管理员核对，勿重复申请');lock.current = true }
    void load()
  }, [storageKey])
  async function submit() {
    if (lock.current || !writable) return
    const payload = attempt || { requestId: crypto.randomUUID(), orderNo, quantity: Number(quantity), reason: reason.trim() }
    if (!payload.orderNo || !Number.isSafeInteger(payload.quantity) || payload.quantity <= 0 || !payload.reason) { setError('请选择原申购单，填写正整数退回数量及原因');return }
    lock.current = true;setBusy(true);setError('');setNotice('')
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(payload));setAttempt(payload)
      const result = await submitNegativePurchase(payload)
      if (!result || result.requestId !== payload.requestId || result.orderNo !== payload.orderNo || result.quantity !== -payload.quantity || !Number.isFinite(result.amount) || !['pending','approved','rejected','cancelled'].includes(result.status)) throw new Error('申请回执不完整，请核对原申请')
      sessionStorage.removeItem(storageKey);setAttempt(null);setOrderNo('');setReason('');setQuantity('1')
      setNotice(`负申购申请已保存：${result.quantity} 件，金额 ${result.amount.toFixed(2)}，${result.status === 'pending' ? '等待财务审核' : '请查看审核结果'}。`)
      await load()
    } catch (e) {
      if ([400,404].includes(Number((e as {status?: number}).status))) {
        sessionStorage.removeItem(storageKey);setAttempt(null);setError(userFacingError(e))
      } else setError(`${userFacingError(e)}。原请求已保留，可使用相同请求重试核对。`)
    }
    finally { lock.current = false;setBusy(false) }
  }
  async function cancel(id: number) {
    if (lock.current || !writable) return
    lock.current = true;setBusy(true);setError('')
    try { await cancelNegativePurchase(id);await load() }
    catch(e) { setError(`撤销结果请先刷新核对，可重试原申请。${userFacingError(e)}`) }
    finally { lock.current = false;setBusy(false) }
  }
  const original = purchases.find(p => p.purchaseNo === orderNo)
  const previewAmount = original?.unitPrice == null ? null : Math.round(original.unitPrice * 100) * Number(quantity) / 100
  return <section className="space-y-3 rounded-lg border border-border-light p-3">
    <div className="flex items-center justify-between"><h3 className="font-semibold">退回清账 / 负申购</h3><Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>刷新审核结果</Button></div>
    <p className="text-xs text-text-muted">按原申购单价退回；审核通过后冲减持有数量，款项退至客户余额。仅可退回尚未出库的持有量，实物退货请先完成退货入库。</p>
    {storageError && <p role="alert" className="text-sm text-red-700">{storageError}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {writable && <div className="space-y-2">
      <select aria-label="原申购单" className="w-full rounded border p-2 text-sm" value={orderNo} disabled={busy || !!attempt} onChange={e => setOrderNo(e.target.value)}>
        <option value="">选择要退回的原申购单</option>
        {purchases.filter(p => p.totalAmount != null).map(p => <option key={p.id} value={p.purchaseNo}>{p.purchaseNo} · {p.productName} · 原数量 {p.qty}</option>)}
      </select>
      <label className="block text-sm">退回数量<input aria-label="退回数量" type="number" min="1" step="1" value={quantity} disabled={busy || !!attempt} onChange={e => setQuantity(e.target.value)} className="ml-2 w-24 rounded border p-2" /></label>
      {original?.unitPrice != null && <p className="text-sm">原成交单价 {original.unitPrice.toFixed(2)} · 本次负金额 {previewAmount != null && Number.isFinite(previewAmount) ? (-previewAmount).toFixed(2) : '—'}（提交时以原单核验）</p>}
      <textarea aria-label="退回原因" placeholder="填写退回原因" maxLength={500} value={reason} disabled={busy || !!attempt} onChange={e => setReason(e.target.value)} className="w-full rounded border p-2 text-sm" />
      <Button size="sm" disabled={busy || !!storageError} onClick={() => void submit()}>{busy ? '正在核对…' : attempt ? '重试核对原申请' : '提交负申购审核'}</Button>
    </div>}
    {rows.map(r => <div key={r.id} className="border-t pt-2 text-xs"><p>{r.orderNo} · {r.quantity} 件 · 金额 {r.amount.toFixed(2)} · {{ pending: '待审核', approved: '审核通过', rejected: '已驳回', cancelled: '已撤销' }[r.status]}</p><p className="text-text-muted">{r.reason}{r.referenceNo ? ` · 退款流水 ${r.referenceNo}` : ''}</p>{writable && r.status === 'pending' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cancel(r.id)}>撤销该申请</Button>}</div>)}
    {!rows.length && <p className="text-xs text-text-muted">暂无负申购记录</p>}
  </section>
}
