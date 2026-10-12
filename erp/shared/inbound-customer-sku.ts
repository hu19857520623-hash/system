/** Customer-facing inbound SKU; strip only this order's known customer prefix. */
export function inboundCustomerSku(
  item: { sku?: string | null; customerSku?: string | null },
  customerCode?: string | null,
): string {
  const custom = String(item.customerSku || '').trim()
  if (custom) return custom
  const sku = String(item.sku || '').trim()
  const prefix = `${String(customerCode || '').trim()}-`
  return prefix.length > 1 && sku.toUpperCase().startsWith(prefix.toUpperCase())
    ? sku.slice(prefix.length)
    : sku
}
