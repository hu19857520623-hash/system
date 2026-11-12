import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './index'
import { registerPageConfirm, type PageConfirmOptions } from '../../utils/pageConfirm'

type Pending = PageConfirmOptions & { resolve: (ok: boolean) => void }

/**
 * 页内确认宿主：替代原生 window.confirm。
 * 取消 / 关闭 / Escape / 点击遮罩 = 不执行；仅显式确认才执行。
 */
export function PageConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending

  useEffect(() => registerPageConfirm(options => new Promise<boolean>(resolve => {
    setPending({ ...options, resolve })
  })), [])

  useEffect(() => {
    if (!pending) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        pending.resolve(false)
        setPending(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  const settle = (ok: boolean) => {
    const current = pendingRef.current
    if (!current) return
    current.resolve(ok)
    setPending(null)
  }

  return (
    <>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false) }}
        >
          <div role="alertdialog" aria-modal="true" aria-label={pending.title} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-text-primary">{pending.title}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{pending.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              {!pending.noticeOnly && (
                <Button variant="secondary" onClick={() => settle(false)}>{pending.cancelLabel || '取消'}</Button>
              )}
              <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
                {pending.confirmLabel || (pending.noticeOnly ? '关闭' : '确认')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
