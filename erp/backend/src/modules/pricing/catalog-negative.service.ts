import { pushCatalogStockToOms } from './oms-catalog-sync.util'
import { notifyOms } from '../../common/oms-notify.util'
import { billingSourceSnapshot } from '../billing/billing-snapshot.util'
import { catalogSkuLookupKeys } from '../../common/catalog-customer.util'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { assertRefundAuthority, reclaimCatalog } from '../inventory/catalog-reclaim.util'
import { paidCatalogPurchase, readCatalogRefunds } from '../billing/catalog-refund-ledger.util'
import { billingCents } from '../billing/billing-workflow.util'

const moduleName = 'catalog_negative'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const view = (r: any) => ({ id: Number(r.id), createdAt: r.createdAt, ...r.detail })
@Injectable()
export class CatalogNegativeService {
  constructor(private readonly prisma: PrismaService) {}
  async submit(body: any) {
    if (!uuid.test(body?.requestId || '') || typeof body.customerCode !== 'string' || typeof body.orderNo !== 'string'
      || !Number.isSafeInteger(body.quantity) || body.quantity <= 0 || body.quantity > 2147483647
      || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) throw new BadRequestException('请填写原申购单、有效退回数量及退回原因（最多500字）')
    return this.prisma.$transaction(async (tx: any) => {
      const customer = await tx.customer.findUnique({ where: { customerCode: body.customerCode } })
      if (!customer || customer.status !== 1) throw new NotFoundException('客户不存在或已停用')
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${customer.id} FOR UPDATE`
      const previous = await tx.operationLog.findFirst({ where: { module: moduleName, targetId: body.requestId } })
      if (previous) {
        const d = previous.detail
        if (d.customerCode !== body.customerCode || d.orderNo !== body.orderNo || d.quantity !== -body.quantity || d.reason !== body.reason.trim()) throw new ConflictException('原负申购请求内容不同，请核对原申请')
        return view(previous)
      }
      const order = await tx.omsCatalogOrder.findUnique({ where: { orderNo: body.orderNo } })
      if (!order || order.customerId !== customer.id) throw new NotFoundException('当前客户的原申购单不存在')
      const charges = await tx.billingCharge.findMany({ where: { customerId: customer.id, source: 'oms', chargeType: 'catalog_purchase', bizRef: order.orderNo } })
      if (!paidCatalogPurchase(order, charges, customer.customerCode)) throw new BadRequestException('仅可对已审核入账且付款依据完整的申购单退回')
      const refunds = await readCatalogRefunds(tx, customer)
      const refunded = refunds.flatMap((r: any) => r.allocations).filter((a: any) => a.orderId === Number(order.id)).reduce((n: number, a: any) => n + a.quantity, 0)
      const pending = await tx.operationLog.findMany({ where: { module: moduleName, action: 'pending', detail: { path: '$.orderNo', equals: order.orderNo } } })
      const reserved = pending.reduce((n: number, r: any) => n - r.detail.quantity, 0)
      if (body.quantity > order.quantity - refunded - reserved) throw new BadRequestException(`当前可退回 ${Math.max(0, order.quantity-refunded-reserved)} 件（已扣除待审核申请）`)
      const keys = catalogSkuLookupKeys(order.sku)
      const holdings = await tx.customerSkuInventory.findMany({ where: { customerId: customer.id, sku: { in: keys }, quantity: { gt: 0 } } })
      if (holdings.length > 1) throw new ConflictException('商品持有记录不唯一，请先核对商品编码')
      const otherPending = await tx.operationLog.findMany({ where: { module: moduleName, action: 'pending', AND: [{ detail: { path: '$.customerCode', equals: customer.customerCode } }, { OR: keys.map(sku => ({ detail: { path: '$.sku', equals: sku } })) }] } })
      const holdingReserved = otherPending.reduce((n: number, r: any) => n - r.detail.quantity, 0)
      if (body.quantity > (holdings[0]?.quantity ?? 0) - holdingReserved) throw new BadRequestException('当前可用持有量不足，或已被待审核退回申请占用；已出库商品请先办理退货入库')
      const cents = billingCents(order.unitPrice) * body.quantity
      if (!Number.isSafeInteger(cents) || cents > 99999999999999) throw new BadRequestException('退回金额超出范围，请分批申请')
      const detail = { requestId: body.requestId, customerCode: customer.customerCode, orderId: Number(order.id), orderNo: order.orderNo, sku: order.sku, quantity: -body.quantity, unitPrice: Number(order.unitPrice), amount: -billingCents(order.unitPrice)*body.quantity/100, reason: body.reason.trim(), status: 'pending' }
      return view(await tx.operationLog.create({ data: { module: moduleName, action: 'pending', targetType: 'oms_catalog_order', targetId: body.requestId, detail } }))
    }, { timeout: 30000, isolationLevel: 'ReadCommitted' })
  }
  async list(customerCode?: string, actor?: number) {
    if (actor !== undefined) await assertRefundAuthority(this.prisma, actor)
    if (actor === undefined && !customerCode) throw new BadRequestException('缺少客户身份')
    const rows = await this.prisma.operationLog.findMany({ where: { module: moduleName, ...(customerCode ? { detail: { path: '$.customerCode', equals: customerCode } } : { action: 'pending' }) }, orderBy: { id: 'desc' }, take: 200 })
    return rows.map(view)
  }
  async cancel(id: number, customerCode: string) {
    if (!Number.isSafeInteger(id) || id <= 0 || !customerCode) throw new BadRequestException('请选择有效的原负申购申请')
    return this.prisma.$transaction(async (tx: any) => {
      const customer = await tx.customer.findUnique({ where: { customerCode } })
      if (!customer) throw new NotFoundException('客户不存在')
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${customer.id} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM operation_log WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.operationLog.findFirst({ where: { id: BigInt(id), module: moduleName } })
      if (!row || row.detail.customerCode !== customerCode) throw new NotFoundException('当前客户的负申购申请不存在')
      if (row.action === 'cancelled') return view(row)
      if (row.action !== 'pending') throw new ConflictException('已审核的申请不能撤销，请刷新核对')
      return view(await tx.operationLog.update({ where: { id: row.id }, data: { action: 'cancelled', detail: { ...row.detail, status: 'cancelled', cancelledAt: new Date().toISOString() } } }))
    }, { timeout: 30000, isolationLevel: 'ReadCommitted' })
  }
  async decide(id: number, body: any, actor: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('请选择有效负申购申请')
    if (!['approved', 'rejected'].includes(body?.decision)) throw new BadRequestException('请选择审核通过或驳回')
    const result = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(actor)} FOR UPDATE`
      await assertRefundAuthority(tx, actor)
      const initial = await tx.operationLog.findFirst({ where: { id: BigInt(id), module: moduleName } })
      if (!initial) throw new NotFoundException('负申购申请不存在')
      const customer = await tx.customer.findUnique({ where: { customerCode: initial.detail.customerCode } })
      if (!customer) throw new NotFoundException('客户不存在')
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${customer.id} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM operation_log WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.operationLog.findUnique({ where: { id: BigInt(id) } }), d = row.detail
      if (row.action !== 'pending') {
        if (row.action !== body.decision) throw new ConflictException('该申请已审核，请刷新核对')
        return view(row)
      }
      let receipt: any = null
      if (body.decision === 'approved') {
        // The existing refund and this approval commit in one transaction.
        receipt = await reclaimCatalog({ $transaction: (fn: any) => fn(tx) }, { clientRequestId: d.requestId, customerCode: d.customerCode, sku: d.sku, quantity: -d.quantity, allocations: [{ orderId: d.orderId, quantity: -d.quantity }], expectedRefundAmount: -d.amount, remark: `负申购 ${d.orderNo}：${d.reason}`.slice(0,500) }, actor)
      }
      const detail = { ...d, status: body.decision, reviewedBy: actor, reviewedAt: new Date().toISOString(), referenceNo: receipt?.referenceNo ?? null }
      return view(await tx.operationLog.update({ where: { id: row.id }, data: { action: body.decision, detail } }))
    }, { timeout: 30000, isolationLevel: 'ReadCommitted' })
    if (result.status !== 'approved') return result
    // Deliver only an existing committed receipt; retries never execute a second refund.
    let syncPending = false
    try {
      const log = await this.prisma.operationLog.findFirst({ where: { module: 'inventory', action: 'catalog_reclaim', detail: { path: '$.response.referenceNo', equals: result.referenceNo } } })
      const receipt = (log?.detail as any)?.response
      if (!receipt || receipt.customerCode !== result.customerCode || receipt.referenceNo !== result.referenceNo || receipt.quantity !== -result.quantity) throw new Error('退款同步回执待核对')
      try { await pushCatalogStockToOms(this.prisma, receipt.sku) } catch { syncPending = true }
      if (!await notifyOms('inventory.changed', receipt.customerCode, { action: 'catalog_reclaim', sku: receipt.sku, quantity: receipt.quantity, remainingQty: receipt.remainingQty, referenceNo: receipt.referenceNo, reason: '负申购审核退回' }).catch(() => false)) syncPending = true
      const customer = await this.prisma.customer.findUnique({ where: { customerCode: receipt.customerCode } })
      if (!customer) throw new Error('客户退款余额待核对')
      const snapshot = await billingSourceSnapshot(this.prisma, customer)
      if (!await notifyOms('billing.changed', customer.customerCode, { balance: Number(customer.balance), monthlySpent: snapshot.monthlyTotal, pendingBill: snapshot.pendingTotal, refunds: snapshot.refunds.map(r => ({ referenceNo: r.referenceNo, amount: r.amount, createdAt: r.createdAt, allocations: r.allocations })) }).catch(() => false)) syncPending = true
    } catch { syncPending = true }
    return { ...result, syncPending, ...(syncPending ? { warning: '退回已入账，OMS通知待同步；可重试原审核，不会重复退款' } : {}) }
  }
}
