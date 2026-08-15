/** 货盘对客户可见的可售池（定价时写入，缺省用本批入库量） */
export function catalogStockPool(pricing: {
  visibleStockQty?: number | null
  inboundQty?: number | null
  purchaseQty?: number | null
}): number {
  if (pricing.visibleStockQty != null) return Math.max(0, Number(pricing.visibleStockQty))
  if (pricing.inboundQty != null && pricing.inboundQty > 0) return pricing.inboundQty
  return Math.max(0, Number(pricing.purchaseQty ?? 0))
}

export function remainingCatalogStock(pricing: {
  visibleStockQty?: number | null
  inboundQty?: number | null
  purchaseQty?: number | null
  soldQty?: number | null
}): number {
  const pool = catalogStockPool(pricing)
  const sold = Math.max(0, Number(pricing.soldQty ?? 0))
  return Math.max(0, pool - sold)
}
