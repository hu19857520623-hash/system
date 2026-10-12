import { getProductsSnapshot } from './inventoryStore'
import { getCustomerCode } from './dataScope'
export { displaySkuText } from './skuDisplayText'

/** UI-only lookup. Never replace the stored SKU used for submissions. */
export function displaySku(sku: string | null | undefined, customerId?: string | null): string {
  const value = String(sku || '').trim()
  const matches = getProductsSnapshot().filter(p => p.internalSku === value && (!customerId || p.customerId === customerId))
  const custom = matches.length === 1 ? matches[0]?.customerSku?.trim() : undefined
  if (custom) return custom
  const code = getCustomerCode(customerId || undefined)
  if (code && code !== '—' && value.toUpperCase().startsWith(`${code.toUpperCase()}-`)) return value.slice(code.length + 1)
  return value.replace(/^TKL\d+-/i, '')
}
