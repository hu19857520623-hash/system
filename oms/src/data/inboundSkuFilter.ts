import { matchText, type SearchMode } from '../components/ui/filters'
import type { InboundOrder } from './mockData'

export function inboundOrderMatchesSku(
  order: Pick<InboundOrder, 'lineItems' | 'skuHint'>,
  query: string,
  mode: SearchMode,
  display: (sku: string) => string,
) {
  if (!query.trim()) return true
  const hint = order.skuHint?.trim() || ''
  const values = [
    ...(order.lineItems || []).map(line => line.sku),
    hint,
    ...hint.split(/[,，;；\s]+/),
  ].filter(Boolean)
  return values.some(sku => matchText(sku, query, mode) || matchText(display(sku), query, mode))
}
