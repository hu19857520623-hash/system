import type { Prisma } from '@prisma/client'
import { ERP_MASTER_PRODUCT_WHERE } from '../../common/product-source.util'

type CatalogInbound = {
  sourceWarehouseCode?: string | null
  poId?: unknown
  omsCustomerCode?: string | null
  items: Array<{ productId: bigint; sku: string }>
}

/** Validate actual ERP product ownership, including legacy category-prefixed SKUs. */
export async function isCatalogPurchaseInbound(order: CatalogInbound, db: Pick<Prisma.TransactionClient, 'product'>): Promise<boolean> {
  const customer = String(order.omsCustomerCode || '').trim().toUpperCase()
  if (customer && customer !== 'TKL') return false
  if (!order.sourceWarehouseCode?.trim() && !order.poId) return false
  if (!order.items.length || order.items.some(item => !item.sku.trim())) return false
  const products = await db.product.findMany({
    where: { AND: [ERP_MASTER_PRODUCT_WHERE, { id: { in: order.items.map(item => item.productId) } }] },
    select: { id: true, sku: true, remark: true },
  })
  return order.items.every(item => products.some(product => product.id === item.productId && product.sku === item.sku
    && !/OMS客户:|OMS 预约入库自动建档/.test(product.remark || '')))
}
