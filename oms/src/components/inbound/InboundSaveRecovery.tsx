import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getStoredAuthSession, apiGet, authSessionScope } from '../../api/client'
import { can } from '../../auth/permissions'
import { useAsyncViewScope } from '../../utils/useAsyncViewScope'
import { userFacingError } from '../../utils/userFacingError'
import type { InboundOrder } from '../../data/mockData'
import { cacheInboundOrder } from '../../data/entityStore'
import { refreshInboundsFromErp } from '../../data/inboundStore'
import { clearInboundSave, readInboundSave, requestInboundSave, withInboundSaveLock, type InboundSaveAttempt } from '../../data/inboundSaveWorkflow'

export default function InboundSaveRecovery({ customerId }: { customerId?: string }) {
  const session = getStoredAuthSession(), user = session?.user.id || '', scope = authSessionScope()
  const view = useAsyncViewScope(JSON.stringify([scope, customerId]))
  const [, tick] = useState(0), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [feedback, setFeedback] = useState('')
  useEffect(() => { const update = () => tick(n => n + 1); window.addEventListener('storage', update); window.addEventListener('oms-inbound-save-change', update); return () => { window.removeEventListener('storage', update); window.removeEventListener('oms-inbound-save-change', update) } }, [])
  useEffect(() => { setBusy(false); setConfirm(false); setFeedback('') }, [scope, customerId])
  if (!user || !customerId) return null
  let attempt: InboundSaveAttempt | null = null, error = ''
  try { attempt = readInboundSave(localStorage, user, customerId) } catch (e) { error = userFacingError(e) }
  if (!attempt && !error && !feedback) return null
  const writable = Boolean(session && can(session.user.role, 'inbound:write', session.user.permissions))
  const act = async (action: 'submit' | 'check' | 'cancel') => {
    if (!attempt || busy) return
    const original = attempt, valid = view.capture()
    const current = () => valid() && authSessionScope() === scope
    setBusy(true); setConfirm(false)
    try {
      await withInboundSaveLock(user, customerId, async () => {
        if (!current()) return
        const result = await requestInboundSave(original, action)
        if (!current()) return
        if (result.status === 'unknown') { setFeedback('尚未查到原保存回执；原请求仍保留。可重试原保存，或确认取消后再重新打开记录。'); return }
        if (result.status === 'confirmed') {
          // A receipt proves the original save, not that its old plan is latest.
          const rows: InboundOrder[] = []
          for (const order of original.orders) {
            const row = await apiGet<InboundOrder>(`/inbound-orders/by-no/${encodeURIComponent(order.inboundNo)}`)
            if (!current()) return
            if (row.customerId !== customerId || row.inboundNo !== order.inboundNo || !row.omsRevision) throw new Error('最新保存记录与原客户或单号不符，请保留原请求')
            rows.push(row)
          }
          for (const row of rows) cacheInboundOrder(row)
          await refreshInboundsFromErp(customerId, current)
          if (!current()) return
          setFeedback('原保存已确认，已读取当前服务器记录。请返回列表核对进度并重新打开；本页未保存输入仍保留，不会自动覆盖新资料。')
        } else setFeedback('原保存请求已确认取消，已完成的保存仍保留。请返回列表读取最新记录后重新打开。')
        if (writable) clearInboundSave(localStorage, original)
        else setFeedback(previous => previous + ' 当前为只读权限，原请求仍保留。')
      })
    } catch (e) { if (current()) setFeedback(`原保存请求仍保留。${userFacingError(e)}`) }
    finally { if (current()) setBusy(false) }
  }
  return <section className="my-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" aria-label="入库草稿保存恢复">
    <p className="font-semibold">{attempt ? '原草稿保存待核对' : error ? '原草稿保存记录无法读取' : '草稿保存核对结果'}</p>
    {attempt && <p className="mt-1 break-words text-xs">原请求包含 {attempt.orders.map(order => order.inboundNo).join('、')}。重试仅使用当时保存的内容，返回列表不会取消原请求。</p>}
    {error && <p role="alert">{error}</p>}
    {feedback && <p className="mt-2" role="status">{feedback}</p>}
    <div className="mt-3 flex flex-wrap gap-4">
      {attempt && <button type="button" disabled={busy} className="underline" onClick={() => void act('check')}>核对原保存结果</button>}
      {attempt && writable && <><button type="button" disabled={busy} className="underline" onClick={() => void act('submit')}>重试原保存</button><button type="button" disabled={busy} className="underline" onClick={() => setConfirm(true)}>取消原保存请求</button></>}
      <Link to="/inbound/records" className="underline">返回入库记录</Link>
    </div>
    {confirm && <div className="mt-3" role="group" aria-label="确认取消草稿保存"><p>确认阻止尚未执行的原保存？已完成的保存会保留，本操作不会撤回 ERP 单据。</p><button type="button" disabled={busy} className="mr-4 underline" onClick={() => void act('cancel')}>确认取消原保存</button><button type="button" disabled={busy} className="underline" onClick={() => setConfirm(false)}>保留原保存</button></div>}
  </section>
}
