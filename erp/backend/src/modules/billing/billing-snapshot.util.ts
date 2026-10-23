import { readCatalogRefunds } from './catalog-refund-ledger.util'
import { billingCents, billingPaidChargeIds } from './billing-workflow.util'
import { parseOmsOutboundPreDeduct } from '../../common/oms-sync-meta.util'
import { BILLING_CHARGE_TYPE_LABELS } from './billing.constants'

const date = (value: any, fallback: string) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || fallback).slice(0, 10)

/** Read only. Assignment to an invoice, an estimate and an actual payment are separate states. */
export async function billingSourceSnapshot(db: any, customer: any, now = new Date()) {
  const today = now.toISOString().slice(0, 10), month = today.slice(0, 7)
  const allCharges: any[] = await db.$queryRawUnsafe("SELECT * FROM billing_charge WHERE customer_id=? AND status IN ('pending','confirmed') ORDER BY id", customer.id)
  const paidIds = await billingPaidChargeIds(db, customer, allCharges)
  const confirmed = allCharges.filter(c => paidIds.has(String(c.id))), pendingRows = allCharges.filter(c => !paidIds.has(String(c.id)))
  const [outbounds, recharges, refunds]: any[][] = await Promise.all([
    db.outboundOrder.findMany({ where: { customerId: customer.id }, select: { id: true, outboundNo: true, status: true, remark: true, shippedAt: true, createdAt: true } }),
    db.customerRecharge.findMany({ where: { customerId: customer.id, status: 'confirmed' }, orderBy: { id: 'asc' } }),
    readCatalogRefunds(db, customer),
  ])
  const provisional = new Set(outbounds.filter(order => !order.shippedAt).map(order => order.outboundNo))
  const shippedRefs = new Set(outbounds.filter(order => order.shippedAt).map(order => order.outboundNo))
  const reviewRows = pendingRows.filter(c => ['erp', 'wms'].includes(c.source) && shippedRefs.has(c.biz_ref))
  const unpaidFinal = pendingRows.filter(c => !(['erp', 'wms'].includes(c.source) && (provisional.has(c.biz_ref) || shippedRefs.has(c.biz_ref))))
  const pendingTotal = unpaidFinal.reduce((n, c) => n + billingCents(c.amount), 0) / 100
  const monthlyGrossCents = confirmed.filter(c => date(c.charge_date, today).slice(0, 7) === month).reduce((n, c) => n + billingCents(c.amount), 0)
  const monthlyTotal = (monthlyGrossCents - refunds.filter(r => date(r.createdAt,today).slice(0,7) === month).reduce((sum,r) => sum+r.amountCents, 0))/100
  const feeRecords: any[] = confirmed.map(c => ({ id: `erp-chg-${c.id}`, date: date(c.charge_date, today), type: c.charge_type === 'outbound_ship' ? 'shipping' : c.charge_type,
    refNo: c.biz_ref || c.charge_no || '—', desc: c.description || BILLING_CHARGE_TYPE_LABELS[c.charge_type] || '其他费用', amount: -billingCents(c.amount) / 100, method: 'actual', customerCode: customer.customerCode }))
  for (const r of recharges) feeRecords.push({ id: `erp-rc-${r.rechargeNo}`, date: date(r.createdAt, today), type: 'recharge', refNo: r.rechargeNo, desc: r.remark || '充值到账', amount: billingCents(r.amount) / 100, method: 'actual', customerCode: customer.customerCode, rechargeNo: r.rechargeNo, paymentMethodTitle: r.paymentMethod })
  for (const refund of refunds) feeRecords.push({ id: `erp-ref-${refund.referenceNo}`, date: date(refund.createdAt,today), type: 'catalog_refund', refNo: refund.referenceNo, desc: `收回货盘持有退款 · ${refund.allocations.map((a:any) => `${a.orderNo} × ${a.quantity}`).join('、')}`, amount: refund.amount, method: 'actual', customerCode: customer.customerCode })
  let reservedCents = 0
  for (const order of outbounds) {
    const pre = billingCents(parseOmsOutboundPreDeduct(order.remark)?.preDeductTotal ?? 0)
    if (pre <= 0) continue
    feeRecords.push({ id: `erp-pre-${order.id}`, date: date(order.createdAt, today), type: 'outbound_pre_deduct', refNo: order.outboundNo, desc: '出库预扣（用于阶段核对，不重复计入实际费用）', amount: -pre / 100, method: 'pre_deduct', customerCode: customer.customerCode })
    if (!order.shippedAt && order.status !== 'cancelled') reservedCents += pre
    const related = allCharges.filter(c => c.biz_ref === order.outboundNo && ['erp', 'wms'].includes(c.source))
    const settled = order.shippedAt && related.length > 0 && related.every(c => paidIds.has(String(c.id)))
    if (order.status === 'cancelled' || settled) {
      const actual = order.status === 'cancelled' ? 0 : related.reduce((n, c) => n + billingCents(c.amount), 0)
      feeRecords.push({ id: `settle-${order.outboundNo}`, date: date(order.shippedAt || order.createdAt, today), type: 'handling', refNo: order.outboundNo,
        desc: order.status === 'cancelled' ? '取消出库退还预扣（仅供对账）' : '预扣与最终实扣的差额（仅供对账）', amount: (pre - actual) / 100, method: 'settlement_adjust', customerCode: customer.customerCode })
    }
  }
  feeRecords.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  return { allCharges, confirmed, pendingRows, recharges, refunds, feeRecords, pendingTotal, monthlyTotal, reservedAmount: reservedCents / 100, provisionalChargeCount: pendingRows.filter(c => ['erp', 'wms'].includes(c.source) && provisional.has(c.biz_ref)).length, reviewAmount: reviewRows.reduce((n, c) => n + billingCents(c.amount), 0) / 100, billingMonth: month }
}
