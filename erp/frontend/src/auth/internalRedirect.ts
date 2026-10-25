/** Login and access-recovery links stay inside this ERP and cannot point back into recovery. */
export function internalRedirect(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/dashboard'
  try {
    const pathname = decodeURIComponent(new URL(value, 'http://erp.invalid').pathname)
    if (pathname.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(pathname) || /^\/(?:login|access-denied)(?:\/|$)/i.test(pathname)) return '/dashboard'
    return value
  } catch { return '/dashboard' }
}
