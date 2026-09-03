export type StocktakeScopeInput = {
  warehouseCode: string
  mode: string
  locationIds: number[]
  skus: string[]
  sampleSize: number
  customerCode: string
  inboundNo: string
  inboundDateFrom: string
  inboundDateTo: string
}

const STOCKTAKE_MODES = new Set(['full', 'location', 'sku', 'spot'])

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function parseStocktakeScope(body: Record<string, unknown> = {}): StocktakeScopeInput {
  const mode = text(body.mode) || 'location'
  const locationIds = Array.isArray(body.locationIds)
    ? body.locationIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : []
  const skus = Array.isArray(body.skus)
    ? body.skus.map((sku) => text(sku)).filter(Boolean)
    : text(body.skusText).split(/[\s,，]+/).map((sku) => sku.trim()).filter(Boolean)
  return {
    warehouseCode: text(body.warehouseCode),
    mode: STOCKTAKE_MODES.has(mode) ? mode : 'location',
    locationIds,
    skus,
    sampleSize: Math.max(1, Math.min(500, Number(body.sampleSize) || 20)),
    customerCode: text(body.customerCode),
    inboundNo: text(body.inboundNo),
    inboundDateFrom: text(body.inboundDateFrom),
    inboundDateTo: text(body.inboundDateTo),
  }
}

export function hasInboundScopeFilter(scope: Pick<StocktakeScopeInput, 'customerCode' | 'inboundNo' | 'inboundDateFrom' | 'inboundDateTo'>) {
  return Boolean(scope.customerCode || scope.inboundNo || scope.inboundDateFrom || scope.inboundDateTo)
}

export function inboundOccurredAtRange(from?: string, to?: string) {
  const createdAt: { gte?: Date; lte?: Date } = {}
  if (from) createdAt.gte = new Date(`${from}T00:00:00+08:00`)
  if (to) createdAt.lte = new Date(`${to}T23:59:59.999+08:00`)
  return Object.keys(createdAt).length ? createdAt : undefined
}

export function stocktakeScopeSnapshot(scope: StocktakeScopeInput) {
  return {
    mode: scope.mode,
    locationIds: scope.locationIds,
    skus: scope.skus,
    sampleSize: scope.mode === 'spot' ? scope.sampleSize : null,
    customerCode: scope.customerCode || null,
    inboundNo: scope.inboundNo || null,
    inboundDateFrom: scope.inboundDateFrom || null,
    inboundDateTo: scope.inboundDateTo || null,
  }
}

export type StocktakeScopeSnapshot = ReturnType<typeof stocktakeScopeSnapshot>

export function stocktakeScopeLabel(scope: Partial<StocktakeScopeSnapshot> | null | undefined) {
  if (!scope) return ''
  const parts: string[] = []
  if (scope.customerCode) parts.push(`客户 ${scope.customerCode}`)
  if (scope.inboundNo) parts.push(`入库 ${scope.inboundNo}`)
  if (scope.inboundDateFrom || scope.inboundDateTo) {
    parts.push(`入库 ${scope.inboundDateFrom || '起始'} ~ ${scope.inboundDateTo || '至今'}`)
  }
  return parts.join(' · ')
}
