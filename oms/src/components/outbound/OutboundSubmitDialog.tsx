import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui'
import { formatCurrency, type OutboundOrder } from '../../data/mockData'

export function OutboundSubmitDialog({ order, busy, onCancel, onConfirm }: {
  order: OutboundOrder; busy: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => { if (busy) dialogRef.current?.focus(); else cancelRef.current?.focus() }, [busy])
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onCancel()
    if (event.key === 'Tab') {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (!buttons.length) { event.preventDefault(); return }
      if (event.shiftKey && event.target === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus() }
      else if (!event.shiftKey && event.target === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
    }
  }}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={busy} aria-label="确认提交出库单" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
      <h2 className="text-base font-semibold">确认提交出库单</h2>
      <p className="mt-3 text-sm">单号：{order.outboundNo}</p>
      <p className="mt-2 text-sm">提交后将锁定 {order.totalQty} 件库存，并预扣 {formatCurrency(order.preDeductTotal ?? 0)}。</p>
      <p className="mt-2 text-xs text-text-muted">仓库接单后可在出库记录查看进度。取消可返回表单继续修改。</p>
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">返回修改</button>
        <Button disabled={busy} onClick={onConfirm}>{busy ? '提交中…' : '确认提交'}</Button>
      </div>
    </section>
  </div>, document.body)
}
