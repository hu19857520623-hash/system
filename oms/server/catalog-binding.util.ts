type Queryable = { $queryRawUnsafe: <T = unknown>(sql: string) => Promise<T> }

/** Catalog identities come from ERP pricing and known OMS pool records, never from a customer's 990. */
export async function catalogBindingSkus(db: Queryable): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<Array<{ sku: string }>>(
    "SELECT sku FROM product_pricing WHERE sku LIKE 'TKL-%' OR visible_on_oms=1 OR orderable_on_oms=1 UNION SELECT internalSku AS sku FROM oms_product WHERE inCatalog=1 OR customerId='tkl'",
  )
  const skus = new Set<string>()
  for (const row of rows) {
    const sku = row.sku.trim().toUpperCase()
    skus.add(sku)
    if (sku.startsWith('TKL-')) skus.add(sku.slice(4))
  }
  return skus
}

export function catalogMappingSource(lines: unknown, skus: Set<string>, requested: unknown): 'owned' | 'catalog' {
  const rows = Array.isArray(lines) ? lines : []
  return rows.some(line => skus.has(String(line?.internalSku || '').trim().toUpperCase())) || requested === 'catalog' ? 'catalog' : 'owned'
}
