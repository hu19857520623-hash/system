type Product = { internalSku: string; inCatalog?: boolean; customerId?: string | null }
type Line = { internalSku: string }

export function bindingStockSource(
  lines: Line[], products: Product[], fallback: 'owned' | 'catalog' = 'owned',
): 'owned' | 'catalog' {
  const selected = lines.filter(line => line.internalSku.trim())
  const matches = selected.map(line => products.filter(product => product.internalSku.toLowerCase() === line.internalSku.trim().toLowerCase()))
  if (matches.some(rows => rows.some(product => product.inCatalog || product.customerId?.toLowerCase() === 'tkl'))) return 'catalog'
  if (selected.length && matches.every(rows => rows.length > 0)) return 'owned'
  return fallback
}
