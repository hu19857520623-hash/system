/**
 * Historical imports may contain strings that were already replaced with
 * question marks before reaching MySQL. Do not expose those broken values in
 * ERP lists; use a stable business identifier instead.
 */
export function readableDisplayText(value: unknown, fallback = '') {
  const text = String(value ?? '').trim()
  if (!text || /\?{3,}|\uFFFD/.test(text)) return String(fallback ?? '').trim()
  return text
}
