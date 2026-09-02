import { normalizeScanCode } from '../outbound/outbound.policy'

export type InboundScanItem = {
  sku: string
  productId?: number | bigint | null
}

/** 只认完整 SKU 或商品条码，不做后缀模糊匹配，避免短码记到错误 SKU。 */
export function findInboundItemByScan<T extends InboundScanItem>(
  items: T[],
  skuToken: string,
  barcodesByProductId: Map<number, string | null | undefined>,
): T | null {
  const token = normalizeScanCode(skuToken)
  if (!token) return null
  const skuHit = items.find((item) => normalizeScanCode(item.sku) === token)
  if (skuHit) return skuHit
  return items.find((item) => {
    const barcode = barcodesByProductId.get(Number(item.productId))
    return !!barcode && normalizeScanCode(barcode) === token
  }) ?? null
}
