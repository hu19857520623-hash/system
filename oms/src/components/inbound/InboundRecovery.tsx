import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InboundOrder } from '../../data/mockData'
import { pendingInboundOperation, readInboundOriginal, retryInboundOriginal } from '../../data/inboundStore'
import { useRole } from '../../auth/RoleContext'
import { userFacingError } from '../../utils/userFacingError'

const labels = { create: '提交入库', update: '修改入库', reactivate: '重新下单', withdraw: '撤回为草稿', void: '作废' }

export default function InboundRecovery({ orders, onCompleted }: { orders: InboundOrder[]; onCompleted?: () => void }) {
  const { userId, authToken } = useRole()
  const currentOwner = useRef('')
  currentOwner.current = `${userId}:${authToken}`
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  useEffect(() => {
    const update = () => setTick(value => value + 1)
    window.addEventListener('storage', update); window.addEventListener('oms-inbound-original-change', update)
    return () => { window.removeEventListener('storage', update); window.removeEventListener('oms-inbound-original-change', update) }
  }, [])
  useEffect(() => { setFeedback({}); setBusy(null) }, [userId, authToken])

  const pending = orders.map(order => ({ order, state: pendingInboundOperation(order) })).filter(row => row.state.record || row.state.error)
  if (!pending.length) return null
  const act = async (order: InboundOrder, retry: boolean) => {
    if (busy) return
    const owner = currentOwner.current
    setBusy(order.inboundNo)
    try {
      const result = retry ? await retryInboundOriginal(order) : await readInboundOriginal(order)
      // Store functions also check the login before writing canonical results.
      if (owner !== currentOwner.current) return
      setFeedback(previous => ({ ...previous, [order.inboundNo]: result.ok
        ? `${result.order.inboundNo}：当前数量 ${result.order.totalQty}，${result.warning || '原操作结果已确认。请返回记录按最新进度继续。'}` : result.error }))
      if (retry && result.ok && !result.persistencePending) onCompleted?.()
    } catch (error) { if (owner === currentOwner.current) setFeedback(previous => ({ ...previous, [order.inboundNo]: userFacingError(error) })) }
    finally { if (owner === currentOwner.current) setBusy(null) }
  }
  return <div className="mb-4 space-y-3" aria-label="入库原操作恢复">
    {pending.map(({ order, state }) => <section key={order.inboundNo} className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" aria-label={`${order.inboundNo} 原操作`}>
      <p className="font-semibold">{order.inboundNo} · {state.record ? `${labels[state.record.kind]}待核对` : '原操作记录无法读取'}</p>
      <p className="mt-1 text-xs">{state.error || `已保存 ${state.record!.createdAt} 的原请求。重试会使用当时的内容；本页后续修改不会加入重试。`}</p>
      <p className="mt-1 text-xs">返回列表或读取原单不会取消已发送的操作，也不会清除待核对记录。</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={Boolean(busy)} className="font-medium underline disabled:opacity-50" onClick={() => void act(order, false)}>读取原单结果</button>
        {state.record && <button type="button" disabled={Boolean(busy)} className="font-medium underline disabled:opacity-50" onClick={() => void act(order, true)}>{busy === order.inboundNo ? '处理中…' : '重试原请求'}</button>}
        <Link to="/inbound/records" className="underline">返回入库记录</Link>
      </div>
      {feedback[order.inboundNo] && <p className="mt-2 text-xs" role="status">{feedback[order.inboundNo]}</p>}
    </section>)}
  </div>
}
