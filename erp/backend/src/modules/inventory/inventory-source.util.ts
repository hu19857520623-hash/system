import { normalizeToJhbWarehouseCode } from '../../common/warehouse-display.util'

type InventoryIdentity = {
  sku?: unknown
  customerCode?: unknown
  warehouseCode?: unknown
  stockSource?: unknown
}

function identity(row: InventoryIdentity): string | null {
  const customer = String(row.customerCode || '').trim().toUpperCase()
  const sku = String(row.sku || '').trim()
  const warehouse = String(row.warehouseCode || '').trim()
  if (!customer || !sku || !warehouse) return null
  return JSON.stringify([customer, sku, normalizeToJhbWarehouseCode(warehouse)])
}

/** Warehouse stock excludes catalog holdings; ERP is authoritative for owned mirrors. */
export function omsInventoryWithoutErpDuplicates<T extends InventoryIdentity>(oms: T[], erp: InventoryIdentity[]): T[] {
  const erpKeys = new Set(erp.map(identity).filter((key): key is string => key !== null))
  return oms.filter(row => {
    if (row.stockSource === 'catalog') return false
    const key = identity(row)
    return key === null || !erpKeys.has(key)
  })
}
