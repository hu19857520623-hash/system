import { createHash } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { billingCents } from './billing-workflow.util'

export const catalogRefundReference = (actor: unknown, requestId: string) => `RCL-${createHash('sha256').update(JSON.stringify([String(actor),requestId])).digest('hex').slice(0,32)}`

export function paidCatalogPurchase(order: any, charges: any[], customerCode: string) {
  try {
    const related = charges.filter(c => c.bizRef === order.orderNo)
    return order.status === 'confirmed' && order.customerCode === customerCode && Number.isSafeInteger(order.quantity) && order.quantity > 0
      && billingCents(order.unitPrice) > 0 && billingCents(order.totalAmount) === billingCents(order.unitPrice) * order.quantity
      && order.balanceBefore != null && order.balanceAfter != null && billingCents(order.balanceBefore) - billingCents(order.balanceAfter) === billingCents(order.totalAmount)
      && related.length === 1 && ['pending', 'confirmed'].includes(related[0].status) && billingCents(related[0].amount) === billingCents(order.totalAmount)
  } catch { return false }
}

/** Refund receipts are written atomically with the wallet credit, never by OMS caches. */
export async function readCatalogRefunds(db: any, customer: any) {
  const rows: any[] = await db.operationLog.findMany({ where: { module: 'inventory', action: 'catalog_reclaim', detail: { path: '$.customerId', equals: Number(customer.id) } }, orderBy: { id: 'asc' } })
  const refunds: any[] = rows.filter(row => row.detail?.refundVersion === 1)
  if (!refunds.length) return []
  const invalid = () => new BadRequestException('历史货盘退款回执不完整，请联系财务核对，勿重复退款')
  const orderIds: bigint[] = []
  for (const row of refunds) {
    const d = row.detail, r = d?.refund
    if (d?.customerId !== Number(customer.id) || d?.response?.customerCode !== customer.customerCode || !r || !Array.isArray(r.allocations) || !r.allocations.length) throw invalid()
    for (const a of r.allocations) { if (!Number.isSafeInteger(a.orderId) || a.orderId <= 0) throw invalid();orderIds.push(BigInt(a.orderId)) }
  }
  const orders: any[] = await db.omsCatalogOrder.findMany({ where: { customerId: customer.id, id: { in: [...new Set(orderIds)] } } })
  const charges: any[] = await db.billingCharge.findMany({ where: { customerId: customer.id, source: 'oms', chargeType: 'catalog_purchase', bizRef: { in: orders.map(o => o.orderNo) } } })
  const refunded = new Map<number, number>(), references = new Set<string>()
  return refunds.map(row => {
    const d = row.detail, r = d.refund, referenceNo = d.response.referenceNo
    if (referenceNo !== catalogRefundReference(row.operatorId,d.clientRequestId) || references.has(referenceNo) || !Number.isSafeInteger(r.amountCents) || r.amountCents <= 0 || billingCents(r.balanceAfter) - billingCents(r.balanceBefore) !== r.amountCents) throw invalid()
    references.add(referenceNo)
    let total = 0, qty = 0
    const allocated = new Set<number>()
    for (const a of r.allocations) {
      const order = orders.find(o => Number(o.id) === a.orderId)
      if (!order || !paidCatalogPurchase(order, charges, customer.customerCode) || allocated.has(a.orderId) || !Number.isSafeInteger(a.quantity) || a.quantity <= 0 || a.orderNo !== order.orderNo || a.unitCents !== billingCents(order.unitPrice) || a.amountCents !== a.quantity * a.unitCents) throw invalid()
      allocated.add(a.orderId);total += a.amountCents;qty += a.quantity
      refunded.set(a.orderId, (refunded.get(a.orderId) || 0) + a.quantity)
      if (refunded.get(a.orderId)! > order.quantity) throw invalid()
    }
    if (total !== r.amountCents || qty !== d.response.quantity || billingCents(d.response.refundAmount) !== total || d.response.clientRequestId !== d.clientRequestId) throw invalid()
    return { referenceNo, createdAt: row.createdAt, amountCents: total, amount: total / 100, allocations: r.allocations }
  })
}
