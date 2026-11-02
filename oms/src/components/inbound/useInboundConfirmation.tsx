import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui'

type Request = { scope: string; message: string; label: string; resolve: (confirmed: boolean) => void }

function Confirmation({ request, onClose }: { request: Request; onClose: (confirmed: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(false) }
    if (event.key === 'Tab') {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
      if (event.shiftKey && event.target === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus() }
      else if (!event.shiftKey && event.target === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
    }
  }}>
    <section role="dialog" aria-modal="true" aria-label={request.label} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
      <h2 className="text-base font-semibold">{request.label}</h2>
      <p className="mt-3 break-words text-sm">{request.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" className="rounded-lg border border-border px-3 py-2 text-sm" onClick={() => onClose(false)}>取消</button>
        <Button onClick={() => onClose(true)}>{request.label}</Button>
      </div>
    </section>
  </div>, document.body)
}

/** Cancels pending confirmation on document/account/permission change or unmount. */
export function useInboundConfirmation(scope: string) {
  const pending = useRef<Request | null>(null)
  const [request, setRequest] = useState<Request | null>(null)
  const close = useCallback((confirmed: boolean) => {
    const current = pending.current
    pending.current = null
    setRequest(null)
    current?.resolve(confirmed)
  }, [])
  useEffect(() => {
    // A promise from the previous view must never resume a write in this view.
    close(false)
    return () => { pending.current?.resolve(false); pending.current = null }
  }, [scope, close])
  const confirm = (message: string, label: string) => new Promise<boolean>(resolve => {
    pending.current?.resolve(false)
    const next = { scope, message, label, resolve }
    pending.current = next
    setRequest(next)
  })
  return { confirm, dialog: request?.scope === scope ? <Confirmation request={request} onClose={close} /> : null }
}
