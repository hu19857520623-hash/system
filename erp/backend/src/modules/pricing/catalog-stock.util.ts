/** 总可见额度受累计良品实收上限约束；已售量由 remainingCatalogStock 单独扣除。 */
export function catalogStockPool(pricing: {
  visibleStockQty?: number | null
  inboundQty?: number | null
  purchaseQty?: number | null
  receivedGoodQty?: number | null
}): number {
  if (pricing.receivedGoodQty != null) {
    const received = Math.max(0, Number(pricing.receivedGoodQty))
    return pricing.visibleStockQty == null ? received : Math.min(received, Math.max(0, Number(pricing.visibleStockQty)))
  }
  if (pricing.visibleStockQty != null) return Math.max(0, Number(pricing.visibleStockQty))
  if (pricing.inboundQty != null && pricing.inboundQty > 0) return pricing.inboundQty
  return Math.max(0, Number(pricing.purchaseQty ?? 0))
}

export function remainingCatalogStock(pricing: {
  visibleStockQty?: number | null
  inboundQty?: number | null
  purchaseQty?: number | null
  soldQty?: number | null
  receivedGoodQty?: number | null
}): number {
  const pool = catalogStockPool(pricing)
  const sold = Math.max(0, Number(pricing.soldQty ?? 0))
  return Math.max(0, pool - sold)
}

/** 本批数量与累计可见额度分别核对，不把总额度压成最新一批数量。 */
export function receivedCatalogQtyPatch(
  row: { inboundQty?: number | null; visibleStockQty?: number | null },
  actualQty: number,
  receivedGoodQty: number = actualQty,
): { inboundQty: number; visibleStockQty?: number } | null {
  const qty = Math.max(0, Math.floor(Number(actualQty) || 0))
  const inboundQty = Number(row.inboundQty ?? 0)
  const data: { inboundQty: number; visibleStockQty?: number } = { inboundQty: qty }
  if (row.visibleStockQty != null && Number(row.visibleStockQty) > receivedGoodQty) {
    data.visibleStockQty = receivedGoodQty
  }
  if (inboundQty === qty && data.visibleStockQty == null) return null
  return data
}
