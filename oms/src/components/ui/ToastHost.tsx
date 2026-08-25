import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { subscribeUserToast, type UserToast } from '../../utils/userNotify'

const KIND_STYLES: Record<UserToast['kind'], string> = {
  ok: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  err: 'bg-red-50 text-red-900 ring-red-200',
  info: 'bg-sky-50 text-sky-900 ring-sky-200',
}

export function ToastHost() {
  const [toast, setToast] = useState<UserToast | null>(null)

  useEffect(() => subscribeUserToast(setToast), [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!toast) return null

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] max-w-md">
      <div
        className={`pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${KIND_STYLES[toast.kind]}`}
        role="alert"
      >
        <div className="flex items-start gap-2">
          <p className="flex-1 whitespace-pre-wrap">{toast.text}</p>
          <button
            type="button"
            className="shrink-0 opacity-60 hover:opacity-100"
            onClick={() => setToast(null)}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
