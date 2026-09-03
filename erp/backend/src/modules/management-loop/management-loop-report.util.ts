import {
  resolveBillingDimensions,
  volumeCbmFromDims,
  type ProductDimensionFields,
} from '../../common/product-dimension.util'

export const PRODUCT_DIM_SELECT = {
  id: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  measuredLengthCm: true,
  measuredWidthCm: true,
  measuredHeightCm: true,
} as const

export function roundCbm(value: number) {
  return Number((Number(value) || 0).toFixed(4))
}

export function inboundReportQty(item: { expectedQty: number; actualQty?: number | null }) {
  return item.actualQty != null ? Number(item.actualQty) : Number(item.expectedQty || 0)
}

export function outboundReportQty(item: { qty: number; pickedQty?: number | null }) {
  const picked = Number(item.pickedQty || 0)
  return picked > 0 ? picked : Number(item.qty || 0)
}

export function reportLineCbm(product: ProductDimensionFields | undefined, qty: number) {
  if (!product || !Number.isFinite(qty) || qty <= 0) return 0
  const dims = resolveBillingDimensions(product)
  const unit = volumeCbmFromDims(dims.lengthCm, dims.widthCm, dims.heightCm)
  return unit == null ? 0 : unit * qty
}

export function sumReportCbm(
  lines: Array<{ productId: bigint | number | string; qty: number }>,
  products: Map<string, ProductDimensionFields>,
) {
  const total = lines.reduce(
    (sum, line) => sum + reportLineCbm(products.get(String(line.productId)), line.qty),
    0,
  )
  return roundCbm(total)
}

export function accumulateChargeAmounts(
  charges: Array<{ bizRef?: string | null; amount: unknown; status?: string | null }>,
) {
  const map = new Map<string, number>()
  for (const charge of charges) {
    if (charge.status === 'cancelled') continue
    const ref = String(charge.bizRef || '')
    if (!ref) continue
    map.set(ref, Number(((map.get(ref) || 0) + Number(charge.amount || 0)).toFixed(2)))
  }
  return map
}

export function userDisplayName(user?: { realName?: string | null; username?: string | null } | null) {
  return String(user?.realName || user?.username || '').trim()
}
