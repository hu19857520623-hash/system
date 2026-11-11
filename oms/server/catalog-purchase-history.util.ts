import { Prisma, type PrismaClient } from '@prisma/client'

type Purchase = { purchaseNo: string; customerId: string; sku: string; qty: number; createdAt: string }
type Receipt = { orderNo: string; customerCode: string | null; sku: string; quantity: number; unitPrice: unknown; totalAmount: unknown; createdAt: Date }

/** Purchase history uses the immutable paid order, never today's catalog or holding price. */
export async function readCatalogPurchaseHistory<T extends Purchase>(db: PrismaClient, purchases: T[], accounts: Array<{ id: string; code: string }>) {
  if (!purchases.length) return []
  const receipts = await db.$queryRaw<Receipt[]>(Prisma.sql`
    SELECT o.order_no AS orderNo, COALESCE(NULLIF(o.customer_code, ''), c.customer_code) AS customerCode,
      o.sku, o.quantity, o.unit_price AS unitPrice, o.total_amount AS totalAmount, o.created_at AS createdAt
    FROM oms_catalog_order o JOIN customer c ON c.id = o.customer_id
    WHERE o.order_no IN (${Prisma.join([...new Set(purchases.map(row => row.purchaseNo))])})
  `)
  const byOrder = new Map(receipts.map(row => [row.orderNo, row]))
  const codes = new Map(accounts.map(row => [row.id, row.code]))
  return purchases.map(row => {
    const receipt = byOrder.get(row.purchaseNo)
    const matches = receipt && codes.get(row.customerId) && receipt.customerCode === codes.get(row.customerId)
      && receipt.sku === row.sku && receipt.quantity === row.qty
      && receipt.unitPrice != null && receipt.totalAmount != null
      && Number.isFinite(Number(receipt.unitPrice)) && Number(receipt.unitPrice) >= 0
      && Number.isFinite(Number(receipt.totalAmount)) && Number(receipt.totalAmount) >= 0
    return {
      ...row,
      unitPrice: matches ? Number(receipt.unitPrice) : null,
      totalAmount: matches ? Number(receipt.totalAmount) : null,
      createdAt: matches ? receipt.createdAt.toISOString().slice(0, 19).replace('T', ' ') : row.createdAt,
    }
  })
}
