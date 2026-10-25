/** A browser recovery URL must remain on this ERP, including its query and hash. */
export function safeInternalPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/dashboard'
  try {
    const pathname = decodeURIComponent(new URL(value, 'http://erp.invalid').pathname)
    if (pathname.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(pathname)) return '/dashboard'
    return value
  } catch { return '/dashboard' }
}

/** Login and access-recovery links cannot point back into recovery. */
export function internalRedirect(value: unknown): string {
  const path = safeInternalPath(value)
  const pathname = decodeURIComponent(new URL(path, 'http://erp.invalid').pathname)
  return /^\/(?:login|access-denied)(?:\/|$)/i.test(pathname) ? '/dashboard' : path
}

export function sessionReturnPath(location: { pathname: string; search?: string; hash?: string }): string {
  if (location.pathname === '/access-denied') return internalRedirect(new URLSearchParams(location.search || '').get('redirect'))
  return internalRedirect(location.pathname + (location.search || '') + (location.hash || ''))
}
