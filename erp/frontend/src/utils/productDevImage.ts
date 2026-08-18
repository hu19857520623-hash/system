export function productDevImageSrc(url: string | undefined | null) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return url
  if (url.startsWith('/api/')) return url
  return `/api${url.startsWith('/') ? url : `/${url}`}`
}
