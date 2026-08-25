export type UserToastKind = 'ok' | 'err' | 'info'

export type UserToast = {
  id: number
  kind: UserToastKind
  text: string
}

type Listener = (toast: UserToast) => void

const listeners = new Set<Listener>()
let nextId = 0

export function subscribeUserToast(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(kind: UserToastKind, text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  const toast: UserToast = { id: ++nextId, kind, text: trimmed }
  listeners.forEach(fn => fn(toast))
}

export function notifySuccess(text: string) {
  publish('ok', text)
}

export function notifyError(text: string) {
  publish('err', text)
}

export function notifyInfo(text: string) {
  publish('info', text)
}

export function errorMessage(err: unknown, fallback = '操作失败'): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string' && err.trim()) return err.trim()
  return fallback
}

/** Skips user-cancelled flows (e.g. file picker). */
export function notifyIfUserError(err: unknown, fallback = '操作失败') {
  const msg = errorMessage(err, fallback)
  if (msg === 'cancelled') return
  notifyError(msg)
}

export function notifyPersistFailed(scope: string, err: unknown) {
  notifyError(`${scope}保存失败：${errorMessage(err, '请检查网络后重试')}`)
}
