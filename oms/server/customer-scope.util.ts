/** 平台货盘共享池客户（与前端 skuCode.CATALOG_CUSTOMER_ID 对齐） */
export const CATALOG_POOL_CUSTOMER_ID = 'tkl'
export const CATALOG_POOL_CUSTOMER_CODE = 'TKL'

export function isCatalogPoolScope(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === CATALOG_POOL_CUSTOMER_ID
}

export type InventoryStateRecord = Record<string, unknown>

export function isCatalogPoolRecord(record: InventoryStateRecord): boolean {
  if (isCatalogPoolScope(record.customerId)) return true
  const id = String(record.customerId ?? '').trim()
  if (id) return false
  return Boolean(record.inCatalog) || String(record.stockSource || '') === 'catalog'
}

export function selectCustomerInventoryState(
  body: {
    inventory?: InventoryStateRecord[]
    products?: InventoryStateRecord[]
    purchases?: InventoryStateRecord[]
  },
  customerId: string,
): {
  ok: true
  inventory: InventoryStateRecord[]
  products: InventoryStateRecord[]
  purchases: InventoryStateRecord[]
} | { ok: false; error: 'Cross-customer mutation denied' } {
  const scope = String(customerId || '').trim()
  if (!scope) return { ok: false, error: 'Cross-customer mutation denied' }

  const pick = (records: InventoryStateRecord[] | undefined) => {
    const owned: InventoryStateRecord[] = []
    for (const record of records || []) {
      if (isCatalogPoolRecord(record)) continue
      const id = record.customerId == null ? '' : String(record.customerId).trim()
      if (id && id !== scope) return null
      owned.push({ ...record, customerId: scope })
    }
    return owned
  }

  const products = pick(body.products)
  if (!products) return { ok: false, error: 'Cross-customer mutation denied' }
  const inventory = pick(body.inventory)
  if (!inventory) return { ok: false, error: 'Cross-customer mutation denied' }
  const purchases = pick(body.purchases)
  if (!purchases) return { ok: false, error: 'Cross-customer mutation denied' }
  return { ok: true, products, inventory, purchases }
}
