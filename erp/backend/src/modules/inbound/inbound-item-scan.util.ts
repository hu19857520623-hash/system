import { normalizeScanCode } from '../outbound/outbound.policy'

export type InboundScanItem = {
  sku: string
  productId?: number | bigint | null
  barcode?: string | null
  platformBarcode?: string | null
  platformBarcodes?: string[] | null
}

export type InboundScanAlias = string | string[] | null | undefined

function aliasList(value: InboundScanAlias): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  const code = String(value || '').trim()
  return code ? [code] : []
}

function itemAliases(item: InboundScanItem, barcodesByProductId: Map<number, InboundScanAlias>): string[] {
  return [
    ...aliasList(barcodesByProductId.get(Number(item.productId))),
    ...aliasList(item.barcode),
    ...aliasList(item.platformBarcode),
    ...aliasList(item.platformBarcodes),
  ]
}

/** 只认完整 SKU、商品条码或已绑定 990，不做后缀模糊匹配，避免短码记到错误 SKU。 */
export function findInboundItemByScan<T extends InboundScanItem>(
  items: T[],
  skuToken: string,
  barcodesByProductId: Map<number, InboundScanAlias> = new Map(),
): T | null {
  const token = normalizeScanCode(skuToken)
  if (!token) return null
  const skuHit = items.find((item) => normalizeScanCode(item.sku) === token)
  if (skuHit) return skuHit
  return items.find((item) => itemAliases(item, barcodesByProductId).some((alias) => normalizeScanCode(alias) === token)) ?? null
}
