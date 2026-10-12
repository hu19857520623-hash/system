export type SkuDisplayValue = string | null | undefined | {
  sku?: string | number | null
  internalSku?: string | null
  customerSku?: string | null
  customerCode?: string | null
  omsCustomerCode?: string | null
  _raw?: { customerSku?: string | null; customerCode?: string | null }
}

/** Presentation only. Keep the original SKU as the option value/API identity. */
export function displaySku(value: SkuDisplayValue, customerCode?: string | null): string {
  if (value == null) return ''
  const item = typeof value === 'string' ? undefined : value
  const custom = String(item?.customerSku || item?._raw?.customerSku || '').trim()
  if (custom) return custom
  const sku = String(typeof value === 'string' ? value : value.sku || value.internalSku || '').trim()
  const code = String(customerCode || item?.customerCode || item?.omsCustomerCode || item?._raw?.customerCode || '').trim()
  if (code && sku.toUpperCase().startsWith(`${code.toUpperCase()}-`)) return sku.slice(code.length + 1)
  // Legacy lines without customer metadata: only the established numbered code.
  return displaySkuText(sku.replace(/^TKL\d+-/i, ''))
}

/** Summaries and UI feedback can contain several internal SKUs. */
export function displaySkuText(value: unknown): string {
  return String(value ?? '').replace(/(^|[^a-zA-Z0-9_-])TKL\d+-([a-zA-Z0-9_-]+)/gi, '$1$2')
}

export function formatSku(row: SkuDisplayValue, column?: { property?: string }, value?: string): string {
  if (column?.property === 'skuSummary' || column?.property === 'skuLabel') return displaySkuText(value)
  return displaySku(row) || displaySku(value)
}
