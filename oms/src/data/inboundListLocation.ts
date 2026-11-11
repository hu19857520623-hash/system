import type { SearchMode } from '../components/ui/filters'

export interface InboundFilters {
  inboundNo: string; inboundNoMode: SearchMode
  referenceNo: string; referenceNoMode: SearchMode
  sku: string; skuMode: SearchMode
  trackingNo: string; warehouse: string; inboundType: string; dateFrom: string; dateTo: string
}
export const defaultInboundFilters: InboundFilters = {
  inboundNo: '', inboundNoMode: 'fuzzy', referenceNo: '', referenceNoMode: 'fuzzy', sku: '', skuMode: 'fuzzy',
  trackingNo: '', warehouse: 'all', inboundType: 'all', dateFrom: '', dateTo: '',
}
const tabs = new Set(['all', 'draft', 'on_the_way', 'receiving', 'completed', 'shelved', 'exception', 'voided'])
export function readInboundListLocation(params: URLSearchParams) {
  const raw = params.get('tab') === 'submitted' ? 'on_the_way' : params.get('tab') || 'all'
  const filters = { ...defaultInboundFilters }
  for (const key of Object.keys(filters) as (keyof InboundFilters)[]) {
    const value = params.get(key)
    if (value == null) continue
    if (key.endsWith('Mode')) {
      if (value === 'exact' || value === 'fuzzy') (filters[key] as string) = value
    } else if (key === 'dateFrom' || key === 'dateTo') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) filters[key] = value
    } else (filters[key] as string) = value
  }
  return { tab: tabs.has(raw) ? raw : 'all', filters }
}
export function inboundListParams(tab: string, filters: InboundFilters) {
  const params = new URLSearchParams()
  if (tabs.has(tab) && tab !== 'all') params.set('tab', tab)
  for (const key of Object.keys(defaultInboundFilters) as (keyof InboundFilters)[]) {
    if (filters[key] !== defaultInboundFilters[key]) params.set(key, filters[key])
  }
  return params
}
export function inboundListReturn(search: string) {
  const location = readInboundListLocation(new URLSearchParams(search))
  const query = inboundListParams(location.tab, location.filters).toString()
  return '/inbound/records' + (query ? '?' + query : '')
}
