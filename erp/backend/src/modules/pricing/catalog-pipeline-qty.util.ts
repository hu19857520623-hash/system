import { catalogSkuLookupKeys } from '../../common/catalog-customer.util'

/** 未形成实际采购数量的单据，不计入货盘采购合计 */
export const CATALOG_PO_EXCLUDED_STATUSES = ['draft', 'rejected', 'cancelled', 'pending_actual_qty']

export const CATALOG_INBOUND_CANCELLED_STATUSES = ['cancelled']

/** 货物尚未到仓完成收货，计入在途 */
export const CATALOG_IN_TRANSIT_INBOUND_STATUSES = new Set([
  'pending_receipt',
  'pending_push',
  'push_failed',
  'pushed',
  'arrived',
  'receiving',
])

export function openInboundRemaining(
  expectedQty: number,
  actualQty: number | null | undefined,
  status: string,
): number {
  if (!CATALOG_IN_TRANSIT_INBOUND_STATUSES.has(status)) return 0
  return Math.max(0, Math.floor(Number(expectedQty) || 0) - Math.max(0, Math.floor(Number(actualQty ?? 0))))
}

/** 在途 = 已采购尚未做成入库单的数量 + 未完结入库单上还没收到的数量 */
export function catalogInTransitQty(input: {
  purchaseTotal: number
  inboundExpectedTotal: number
  openInboundRemaining: number
}): number {
  const purchase = Math.max(0, Math.floor(Number(input.purchaseTotal) || 0))
  const expected = Math.max(0, Math.floor(Number(input.inboundExpectedTotal) || 0))
  const open = Math.max(0, Math.floor(Number(input.openInboundRemaining) || 0))
  return Math.max(0, purchase - expected) + open
}

export type CatalogPipelineQty = {
  purchaseQty: number
  inboundExpectedTotal: number
  openInboundRemaining: number
  inTransitQty: number
}

export function emptyCatalogPipelineQty(): CatalogPipelineQty {
  return { purchaseQty: 0, inboundExpectedTotal: 0, openInboundRemaining: 0, inTransitQty: 0 }
}

export function buildCatalogSkuIndex(skus: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const sku of skus) {
    for (const key of catalogSkuLookupKeys(sku)) {
      const list = index.get(key) || []
      if (!list.includes(sku)) list.push(sku)
      index.set(key, list)
    }
  }
  return index
}

export function addQtyForCatalogSku(
  index: Map<string, string[]>,
  map: Map<string, number>,
  itemSku: string,
  qty: number,
) {
  const amount = Math.max(0, Math.floor(Number(qty) || 0))
  if (!amount) return
  const targets = index.get(itemSku) || catalogSkuLookupKeys(itemSku).flatMap((key) => index.get(key) || [])
  for (const sku of [...new Set(targets)]) {
    map.set(sku, (map.get(sku) || 0) + amount)
  }
}

export function finishCatalogPipelineQty(
  sku: string,
  purchase: Map<string, number>,
  inboundExpected: Map<string, number>,
  openRemaining: Map<string, number>,
): CatalogPipelineQty {
  const purchaseQty = purchase.get(sku) || 0
  const inboundExpectedTotal = inboundExpected.get(sku) || 0
  const open = openRemaining.get(sku) || 0
  return {
    purchaseQty,
    inboundExpectedTotal,
    openInboundRemaining: open,
    inTransitQty: catalogInTransitQty({
      purchaseTotal: purchaseQty,
      inboundExpectedTotal,
      openInboundRemaining: open,
    }),
  }
}
