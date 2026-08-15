/** 商品尺寸：length/width/height 为客户申报；measured* 为仓库实测。仓租优先用实测，其次客户申报。 */

export type ProductDimensionFields = {
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
  measuredLengthCm?: number | null
  measuredWidthCm?: number | null
  measuredHeightCm?: number | null
}

export function numDim(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function hasCompleteDims(l: number | null, w: number | null, h: number | null): boolean {
  return l != null && w != null && h != null && l > 0 && w > 0 && h > 0
}

export function formatDimLabel(l: number | null, w: number | null, h: number | null): string {
  if (!hasCompleteDims(l, w, h)) return ''
  return `${l} x ${w} x ${h}`
}

export function resolveBillingDimensions(p: ProductDimensionFields) {
  const customer = {
    lengthCm: numDim(p.lengthCm),
    widthCm: numDim(p.widthCm),
    heightCm: numDim(p.heightCm),
  }
  const measured = {
    lengthCm: numDim(p.measuredLengthCm),
    widthCm: numDim(p.measuredWidthCm),
    heightCm: numDim(p.measuredHeightCm),
  }
  if (hasCompleteDims(measured.lengthCm, measured.widthCm, measured.heightCm)) {
    return { ...measured, source: 'measured' as const }
  }
  if (hasCompleteDims(customer.lengthCm, customer.widthCm, customer.heightCm)) {
    return { ...customer, source: 'customer' as const }
  }
  return {
    lengthCm: measured.lengthCm ?? customer.lengthCm,
    widthCm: measured.widthCm ?? customer.widthCm,
    heightCm: measured.heightCm ?? customer.heightCm,
    source: 'none' as const,
  }
}

export function volumeCbmFromDims(l: number | null, w: number | null, h: number | null): number | null {
  if (!hasCompleteDims(l, w, h)) return null
  return Number(((l! * w! * h!) / 1_000_000).toFixed(6))
}
