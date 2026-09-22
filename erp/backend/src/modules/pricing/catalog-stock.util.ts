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

/** 入库完结后把货盘「本批入库」改成实收；可见库存若高于实收则一并压到实收，避免短收仍按 ASN 可卖 */
export function receivedCatalogQtyPatch(
  row: { inboundQty?: number | null; visibleStockQty?: number | null },
  actualQty: number,
): { inboundQty: number; visibleStockQty?: number } | null {
  const qty = Math.max(0, Math.floor(Number(actualQty) || 0))
  const inboundQty = Number(row.inboundQty ?? 0)
  const data: { inboundQty: number; visibleStockQty?: number } = { inboundQty: qty }
  if (row.visibleStockQty != null && Number(row.visibleStockQty) > qty) {
    data.visibleStockQty = qty
  }
  if (inboundQty === qty && data.visibleStockQty == null) return null
  return data
}
