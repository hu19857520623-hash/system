import { normalizeToJhbWarehouseCode } from '../../common/warehouse-display.util'
import { buildInventoryQuantityFields, type UnifiedQuantityFields } from '../../common/inventory-row-mapper.util'

export function inventoryOwnerKey(customerCode: string, sku: string, warehouseCode: string) {
  return JSON.stringify([customerCode.toUpperCase(), sku, normalizeToJhbWarehouseCode(warehouseCode)])
}

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
  return inventoryOwnerKey(customer, sku, warehouse)
}

/** Warehouse stock excludes catalog holdings; ERP is authoritative for owned mirrors. */
export function omsInventoryWithoutErpDuplicates<T extends InventoryIdentity & Partial<UnifiedQuantityFields> & { id?: unknown }>(oms: T[], erp: InventoryIdentity[]): T[] {
  const erpKeys = new Set(erp.map(identity).filter((key): key is string => key !== null))
  return oms.flatMap(row => {
    if (row.stockSource === 'catalog') return []
    const key = identity(row)
    if (key !== null && erpKeys.has(key)) return []
    // ERP-generated mirrors cannot supply warehouse stock without an ERP row for the same owner.
    if (!String(row.id || '').startsWith('oms-erp-o-')) return [row]
    if (!row.inTransitQty && !row.pendingPutawayQty && !row.defectiveQty) return []
    return [{ ...row, ...buildInventoryQuantityFields({
      available: 0,
      inTransit: row.inTransitQty,
      pendingPutaway: row.pendingPutawayQty,
      defective: row.defectiveQty,
    }) }]
  })
}

export function matchesOmsInventoryQuantity(row: Pick<UnifiedQuantityFields, 'availableQty' | 'lockedQty' | 'totalQty'>, filters: {
  qtyType?: string; qtyMin?: number | null; qtyMax?: number | null; lowStockOnly?: boolean; onlyAvailable?: boolean
}) {
  const qty = filters.qtyType === 'locked' ? row.lockedQty : filters.qtyType === 'total' ? row.totalQty : row.availableQty
  return (!(filters.lowStockOnly || filters.onlyAvailable) || qty > 0)
    && (filters.qtyMin == null || !Number.isFinite(filters.qtyMin) || qty >= filters.qtyMin)
    && (filters.qtyMax == null || !Number.isFinite(filters.qtyMax) || qty <= filters.qtyMax)
}
