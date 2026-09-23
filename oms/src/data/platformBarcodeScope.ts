/** Takealot 990 listing barcode (not a factory EAN). */
export function isTakealot990Barcode(code?: string | null): boolean {
  const value = String(code || '').trim()
  return /^990\d{10,}$/i.test(value)
}

/**
 * Catalog-pool EAN is shared master data. Customer holdings must not inherit a
 * 990 — each customer binds their own Takealot barcode for the same SKU.
 */
export function holdingEanFromCatalogPool(poolEan?: string | null): string | undefined {
  const ean = String(poolEan || '').trim()
  if (!ean || isTakealot990Barcode(ean)) return undefined
  return ean
}

/** 990 mappings belong to one customer; unscoped rows are not inherited. */
export function mappingBelongsToCustomer(
  mapping: { customerId?: string | null },
  customerId?: string | null,
): boolean {
  if (!customerId) return true
  return mapping.customerId === customerId
}

export function mappingsForInternalSku<T extends {
  status: string
  customerId?: string | null
  lines: Array<{ internalSku: string }>
}>(
  mappings: T[],
  internalSku: string,
  customerId?: string | null,
): T[] {
  return mappings.filter(mapping =>
    mappingBelongsToCustomer(mapping, customerId)
    && mapping.lines.some(line => line.internalSku === internalSku))
}

/**
 * SKU → 990 is per customer. Admin with no customer selected only returns a
 * barcode when every matching mapping shares the same 990.
 */
export function pickPrimaryPlatformBarcode(
  mappings: Array<{
    status: string
    platformBarcode: string
    customerId?: string | null
    lines: Array<{ internalSku: string }>
  }>,
  internalSku: string,
  customerId?: string | null,
): string | undefined {
  const active = mappingsForInternalSku(mappings, internalSku, customerId)
    .filter(mapping => mapping.status === 'active')
  if (customerId) return active[0]?.platformBarcode
  const unique = [...new Set(active.map(mapping => mapping.platformBarcode).filter(Boolean))]
  return unique.length === 1 ? unique[0] : undefined
}
