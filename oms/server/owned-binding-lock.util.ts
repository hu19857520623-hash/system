type Binding = { id: string; customerId?: string | null; stockSource?: string; platform?: string; platformBarcode?: string; sellerId?: string | null; storeId?: string; status?: string; lines: unknown }
type Db = { $queryRawUnsafe: <T = unknown>(sql: string, ...args: unknown[]) => Promise<T> }
export const OWNED_BINDING_LOCK_MESSAGE = '自有库存商品有库存，不能修改或删除原 990 绑定；请在发货时填写本次出库的其他 990 标签。'
export class OwnedBindingLockedError extends Error { constructor() { super(OWNED_BINDING_LOCK_MESSAGE) } }
export function bindingLines(value: unknown): Array<{ internalSku: string; qty?: number }> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(parsed) ? parsed : []
}
function identity(m: Binding) {
  return JSON.stringify([m.customerId || '', m.platform, m.platformBarcode, m.sellerId || '', m.storeId, m.status, m.stockSource,
    bindingLines(m.lines).map(l => [l.internalSku, Number(l.qty || 1)]).sort()])
}
export async function ownedBindingHasStock(db: Db, m: Binding): Promise<boolean> {
  if (m.stockSource === 'catalog') return false
  for (const line of bindingLines(m.lines)) {
    const rows = await db.$queryRawUnsafe<Array<{ present: number }>>(
      `SELECT 1 AS present FROM oms_inventoryitem WHERE sku=? AND customerId <=> ? AND stockSource <> 'catalog'
       AND (available>0 OR locked>0 OR inTransit>0 OR pendingShelving>0 OR pendingOutbound>0 OR defective>0)
       UNION SELECT 1 AS present FROM inventory WHERE sku=? AND (total_qty>0 OR available_qty>0 OR locked_qty>0) LIMIT 1`,
      line.internalSku, m.customerId || null, line.internalSku)
    if (rows.length) return true
  }
  return false
}
export async function assertOwnedBindingMutation(db: Db, previous: Binding | undefined, next: Binding | undefined, all: Binding[]) {
  if (previous && next && identity(previous) === identity(next)) return
  if (previous && (!next || identity(previous) !== identity(next)) && await ownedBindingHasStock(db, previous)) throw new OwnedBindingLockedError()
  if (!next) return
  // A new id or a source toggle must not create an alternative permanent barcode for stocked owned goods.
  const skus = new Set(bindingLines(next.lines).map(l => l.internalSku))
  for (const other of all) {
    if (other.id === next.id || other.customerId !== next.customerId || other.stockSource === 'catalog' || other.platform !== next.platform) continue
    if (other.platformBarcode === next.platformBarcode) continue
    if (bindingLines(other.lines).some(l => skus.has(l.internalSku)) && await ownedBindingHasStock(db, other)) throw new OwnedBindingLockedError()
  }
}
