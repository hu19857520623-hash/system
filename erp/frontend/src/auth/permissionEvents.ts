const listeners = new Set<() => void>()

export function subscribePermissionFailures(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Only signals a fresh ERP denial; never retries the failed business operation. */
export function notifyPermissionFailure(url: string, status: number, sameSession: boolean) {
  const path = String(url).split('?')[0]
  if (status !== 403 || !sameSession || /^\/(?:auth|store-monitor)(?:\/|$)/.test(path)) return
  for (const listener of listeners) {
    try { listener() } catch { /* A recovery listener must not replace the original API error. */ }
  }
}
