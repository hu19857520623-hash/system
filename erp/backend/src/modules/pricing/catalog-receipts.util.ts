import { BadRequestException } from '@nestjs/common'
import { catalogSkuLookupKeys, toCatalogInternalSku } from '../../common/catalog-customer.util'
import { ERP_MASTER_PRODUCT_WHERE } from '../../common/product-source.util'

type CatalogReceiptRow = { sku: string; inboundNo?: string | null }
const complete = new Set(['completed', 'confirmed'])

/** Only accepted ERP catalog receipts count; ASN, transit and failed QC never increase the pool. */
export async function catalogReceiptTotals(db: any, rows: CatalogReceiptRow[]) {
  const totals = new Map<string, number>(), batches = new Map<string, Map<string, number>>()
  const wanted = new Set(rows.map(row => toCatalogInternalSku(row.sku)))
  for (const key of wanted) totals.set(key, 0)
  if (!rows.length) return { totals, batches }
  const keys = new Set(rows.flatMap(row => catalogSkuLookupKeys(row.sku)))
  const nos = [...new Set(rows.map(row => row.inboundNo).filter(Boolean))]
  // The latest receipt also resolves long source SKUs shortened by the catalog SKU hash.
  if (nos.length) {
    const anchors = await db.inboundOrder.findMany({ where: { inboundNo: { in: nos } }, include: { items: true } })
    for (const order of anchors) for (const item of order.items) if (wanted.has(toCatalogInternalSku(item.sku))) keys.add(item.sku)
  }
  const orders = await db.inboundOrder.findMany({
    where: { status: { in: [...complete] }, items: { some: { sku: { in: [...keys] } } } }, include: { items: true },
  })
  const products = await db.product.findMany({ where: { AND: [ERP_MASTER_PRODUCT_WHERE, { sku: { in: [...keys] } }] }, select: { id: true, sku: true } })
  const masterIds = new Set(products.map((product: any) => String(product.id))), masterSkus = new Set(products.map((product: any) => product.sku))
  for (const order of orders) {
    const owner = String(order.omsCustomerCode || '').trim().toUpperCase()
    if (!complete.has(order.status) || (owner && owner !== 'TKL') || (!order.sourceWarehouseCode?.trim() && !order.poId)) continue
    const batch = new Map<string, number>()
    for (const item of order.items) {
      const key = toCatalogInternalSku(item.sku)
      if (!wanted.has(key)) continue
      if (item.productId != null ? !masterIds.has(String(item.productId)) : !masterSkus.has(item.sku)) continue
      if (item.qcStatus === 'fail') { if (!batch.has(key)) batch.set(key, 0);continue }
      // Completed legacy receipts may predate the QC flag. Explicit failed QC is always excluded.
      const quantity = item.actualQty ?? 0
      if (!Number.isSafeInteger(quantity) || quantity < 0) throw new BadRequestException('累计良品实收数量异常，请先核对入库明细')
      const sum = (totals.get(key) || 0) + quantity
      if (!Number.isSafeInteger(sum) || sum > 2147483647) throw new BadRequestException('累计良品实收数量超出范围，请联系管理员核对')
      totals.set(key, sum);batch.set(key, (batch.get(key) || 0) + quantity)
    }
    batches.set(order.inboundNo, batch)
  }
  return { totals, batches }
}

export async function withCatalogReceiptCaps<T extends CatalogReceiptRow>(db: any, rows: T[]): Promise<Array<T & { receivedGoodQty: number }>> {
  const { totals } = await catalogReceiptTotals(db, rows)
  return rows.map(row => ({ ...row, receivedGoodQty: totals.get(toCatalogInternalSku(row.sku)) || 0 }))
}
