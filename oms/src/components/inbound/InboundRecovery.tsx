import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InboundOrder } from '../../data/mockData'
import { pendingInboundOperation, readInboundOriginal, retryInboundOriginal, resolveInboundOriginal } from '../../data/inboundStore'
import { useRole } from '../../auth/RoleContext'
import { userFacingError } from '../../utils/userFacingError'
import { useAsyncViewScope } from '../../utils/useAsyncViewScope'

const labels = { create: '提交入库', update: '修改入库', reactivate: '重新下单', withdraw: '撤回为草稿', void: '作废' }

export default function InboundRecovery({ orders, onCompleted }: { orders: InboundOrder[]; onCompleted?: () => void }) {
  const { userId, authToken, can } = useRole()
  const canWrite = can('inbound:write')
  const viewKey = JSON.stringify([userId, authToken, orders.map(order => [order.customerId, order.inboundNo]).sort()])
  const view = useAsyncViewScope(viewKey)
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  useEffect(() => {
    const update = () => setTick(value => value + 1)
    window.addEventListener('storage', update); window.addEventListener('oms-inbound-original-change', update)
    return () => { window.removeEventListener('storage', update); window.removeEventListener('oms-inbound-original-change', update) }
  }, [])
  useEffect(() => { setFeedback({}); setBusy(null); setConfirmCancel(null) }, [viewKey])

  const pending = orders.map(order => ({ order, state: pendingInboundOperation(order) })).filter(row => row.state.record || row.state.error)
  if (!pending.length && !Object.keys(feedback).length) return null
  const act = async (order: InboundOrder, action: 'read' | 'retry' | 'check' | 'cancel') => {
    if (busy) return
    const isCurrent = view.capture()
    setConfirmCancel(null)
    setBusy(order.inboundNo)
    try {
      const result = action === 'retry' ? await retryInboundOriginal(order)
        : action === 'read' ? await readInboundOriginal(order) : await resolveInboundOriginal(order, action === 'cancel')
      // Store functions also check the login before writing canonical results.
      if (!isCurrent()) return
      setFeedback(previous => ({ ...previous, [order.inboundNo]: result.ok
        ? `${result.order.inboundNo}：当前数量 ${result.order.totalQty}，${result.warning || '原操作结果已确认。请返回记录按最新进度继续。'}` : result.error }))
      const remaining = pendingInboundOperation(order)
      if (action !== 'read' && result.ok && !result.persistencePending && !remaining.record && !remaining.error) onCompleted?.()
    } catch (error) { if (isCurrent()) setFeedback(previous => ({ ...previous, [order.inboundNo]: userFacingError(error) })) }
    finally { if (isCurrent()) setBusy(null) }
  }
  return <div className="mb-4 space-y-3" aria-label="入库原操作恢复">
    {pending.map(({ order, state }) => <section key={order.inboundNo} className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" aria-label={`${order.inboundNo} 原操作`}>
      <p className="font-semibold">{order.inboundNo} · {state.record ? `${labels[state.record.kind]}待核对` : '原操作记录无法读取'}</p>
      <p className="mt-1 text-xs">{state.error || `已保存 ${state.record!.createdAt} 的原请求。重试会使用当时的内容；本页后续修改不会加入重试。`}</p>
      <p className="mt-1 text-xs">返回列表或读取原单不会取消已发送的操作，也不会清除待核对记录。</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={Boolean(busy)} className="font-medium underline disabled:opacity-50" onClick={() => void act(order, 'read')}>读取原单结果</button>
        {state.record && <button type="button" disabled={Boolean(busy)} className="font-medium underline disabled:opacity-50" onClick={() => void act(order, 'check')}>核对原请求回执</button>}
        {state.record && canWrite && <>
          <button type="button" disabled={Boolean(busy)} className="font-medium underline disabled:opacity-50" onClick={() => void act(order, 'retry')}>{busy === order.inboundNo ? '处理中…' : '重试原请求'}</button>
          <button type="button" disabled={Boolean(busy)} className="font-medium underline disabled:opacity-50" onClick={() => setConfirmCancel(order.inboundNo)}>取消待核对请求</button>
        </>}
        <Link to="/inbound/records" className="underline">返回入库记录</Link>
      </div>
      {canWrite && confirmCancel === order.inboundNo && <div className="mt-3 rounded border border-amber-400 p-3" role="group" aria-label="确认取消原请求">
        <p>确认阻止该原请求继续执行？服务器会先核对执行回执。已经完成的操作和现有仓库单据会保留，本操作不会撤回收货或作废入库单。</p>
        <div className="mt-2 flex gap-4"><button type="button" disabled={Boolean(busy)} className="underline" onClick={() => void act(order, 'cancel')}>确认取消待核对请求</button>
          <button type="button" disabled={Boolean(busy)} className="underline" onClick={() => setConfirmCancel(null)}>保留原请求</button></div>
      </div>}
    </section>)}
    {Object.entries(feedback).map(([no, message]) => <p key={no} className="rounded border border-amber-200 bg-amber-50 p-3 text-xs" role="status">{message}</p>)}
  </div>
}
