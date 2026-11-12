import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { BillingService } from '../billing/billing.service'
import { billingCents, billingPaidChargeIds } from '../billing/billing-workflow.util'
import { OUTBOUND_SHIP_BASE, PACK_UNIT_FEE, PICKING_UNIT_FEE, RELABEL_UNIT_FEE } from './outbound.policy'
import { parseOmsOutboundActualFees, parseOmsOutboundPreDeduct } from '../../common/oms-sync-meta.util'

export type OutboundShipCharge = { chargeNo: string; id?: number; chargeType: string; amount: number; description: string; bizRef?: string | null }
type OutboundOrderForBilling = {
  id: bigint; outboundNo: string; customerId: bigint | null; warehouseCode: string; destType: string; remark: string | null
  needsRelabel: boolean; relabelPrintCount: number; items: Array<{ qty: number; pickedQty: number }>
}
const json = (value: any) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? Number(v) : v))

@Injectable()
export class OutboundBillingService {
  constructor(private prisma: PrismaService, private billing: BillingService) {}

  /** Shares the stock/status transaction; fee failure must not leave the order shipped. */
  async recordShipCharges(order: OutboundOrderForBilling, tx: Prisma.TransactionClient, operatorId: number): Promise<OutboundShipCharge[]> {
    if (!order.customerId) return []
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${order.customerId} FOR UPDATE`
    const customer = await tx.customer.findUnique({ where: { id: order.customerId } })
    if (!customer) throw new BadRequestException('发运客户不存在，请核对客户资料')
    const previous = await tx.operationLog.findFirst({ where: { module: 'billing', action: 'outbound_payment', targetId: order.outboundNo } })
    if (previous) throw new ConflictException('此出库单已有发运支付凭据，请返回列表核对发运状态，勿再次扣款')
    const existing: any[] = await tx.$queryRawUnsafe("SELECT * FROM billing_charge WHERE customer_id=? AND biz_ref=? AND source IN ('erp','wms') ORDER BY id FOR UPDATE", customer.id, order.outboundNo)
    const actual = parseOmsOutboundActualFees(order.remark), pre = parseOmsOutboundPreDeduct(order.remark)
    const preCents = billingCents(pre?.preDeductTotal ?? 0)
    if (preCents < 0) throw new BadRequestException('预扣金额无效，请核对原始费用')
    if (pre && !actual) throw new BadRequestException('请先完成复核打包的实测计费，再继续发运')
    const qty = order.items.reduce((s, i) => s + (i.pickedQty || i.qty), 0)
    if (!Number.isSafeInteger(qty) || qty <= 0) throw new BadRequestException('发运数量无效，请核对复核打包结果')
    const lines = actual ? actual.lines.map(line => ({ type: line.chargeType || (line.type === 'shipping' ? 'outbound_ship' : 'handling'), amount: line.amount, description: `${line.label || '出库费用'} · ${order.outboundNo} · ${line.detail || '实测计费'}` }))
      : [
        { type: 'picking', amount: Number((qty * PICKING_UNIT_FEE).toFixed(2)), description: `出库拣货 · ${order.outboundNo} · ${qty} 件` },
        { type: 'handling', amount: Number((qty * PACK_UNIT_FEE).toFixed(2)), description: `出库打包 · ${order.outboundNo}` },
        { type: 'outbound_ship', amount: OUTBOUND_SHIP_BASE, description: `出库运费 · ${order.outboundNo}` },
      ]
    if (actual && lines.reduce((n, l) => n + billingCents(l.amount), 0) !== billingCents(actual.actualTotal)) throw new BadRequestException('实测费用合计与明细不一致，请重新复核计费')
    if (order.needsRelabel) {
      const count = order.relabelPrintCount > 0 ? order.relabelPrintCount : qty
      lines.push({ type: 'relabel', amount: Number((count * RELABEL_UNIT_FEE).toFixed(2)), description: `换标作业 · ${order.outboundNo} · ${count} 件` })
    }
    const finalLines = lines.filter(line => {
      if (billingCents(line.amount) < 0 || !['picking', 'handling', 'outbound_ship', 'relabel'].includes(line.type)) throw new BadRequestException('发运费用类型或金额无效，请核对计费明细')
      return billingCents(line.amount) > 0
    })
    const used = new Set<string>(), charges: OutboundShipCharge[] = []
    for (const [index, line] of finalLines.entries()) {
      const row = existing.find(c => c.charge_type === line.type && !used.has(String(c.id)))
      if (row) {
        used.add(String(row.id))
        if (billingCents(row.amount) !== billingCents(line.amount)) {
          if (row.billing_id || row.status !== 'pending') throw new ConflictException('预估费用已进入账单且与实测不一致，请先核对原账单，再继续发运')
          await tx.$executeRawUnsafe("UPDATE billing_charge SET amount=?,unit_price=?,quantity=1,description=? WHERE id=? AND billing_id IS NULL AND status='pending'", line.amount, line.amount, line.description, row.id)
        }
        charges.push({ id: Number(row.id), chargeNo: row.charge_no, chargeType: line.type, amount: line.amount, description: line.description, bizRef: order.outboundNo })
      } else {
        const created = await this.billing.createCharge({ customerId: Number(customer.id), chargeType: line.type, source: 'erp', amount: line.amount, quantity: 1, unitPrice: line.amount, description: line.description, bizRef: order.outboundNo, sourceRef: order.outboundNo, warehouseCode: order.warehouseCode, idempotencyKey: `outbound-final:${order.id}:${index}` }, tx, false)
        if (!created.id) throw new ConflictException('发运费用写入后未能核对，请返回原操作重试')
        charges.push(created)
      }
    }
    if (existing.some(row => !used.has(String(row.id)))) throw new ConflictException('预估费用存在未匹配明细，请核对原计费后再继续发运')
    const total = charges.reduce((n, c) => n + billingCents(c.amount), 0), delta = preCents - total, before = billingCents(customer.balance)
    if (delta < 0 && before < -delta) throw new BadRequestException(`余额不足：发运还需补扣 ¥${(-delta / 100).toFixed(2)}，当前余额 ¥${(before / 100).toFixed(2)}；请先充值后使用原发运操作重试`)
    if (delta !== 0) await tx.customer.update({ where: { id: customer.id }, data: { balance: { increment: (delta / 100).toFixed(2) } } })
    await tx.operationLog.create({ data: { module: 'billing', action: 'outbound_payment', operatorId: BigInt(operatorId), targetType: 'outbound_order', targetId: order.outboundNo,
      detail: json({ customerId: Number(customer.id), outboundId: Number(order.id), preDeductAmount: preCents / 100, actualAmount: total / 100, balanceBefore: before / 100, balanceAfter: (before + delta) / 100, balanceDelta: delta / 100, estimatedCharges: existing,
        allocations: charges.map(c => ({ ...c, chargeId: c.id, paidAmount: c.amount })) }) } })
    return charges
  }

  /** Recovery never guesses whether a legacy debit happened, and never changes balances. */
  async paidShipCharges(order: { outboundNo: string; customerId: bigint | null }): Promise<OutboundShipCharge[]> {
    if (!order.customerId) return []
    const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId } })
    if (!customer) throw new BadRequestException('发运客户不存在，请核对原单据')
    const rows: any[] = await this.prisma.$queryRawUnsafe("SELECT * FROM billing_charge WHERE customer_id=? AND biz_ref=? AND source IN ('erp','wms') ORDER BY id", customer.id, order.outboundNo)
    const receipt = await this.prisma.operationLog.findFirst({ where: { module: 'billing', action: 'outbound_payment', targetId: order.outboundNo } })
    if (!rows.length && receipt && (receipt.detail as any)?.actualAmount === 0) return []
    const paid = await billingPaidChargeIds(this.prisma, customer, rows)
    if (!rows.length || rows.some(row => !paid.has(String(row.id)))) throw new ConflictException('历史发运费用缺少完整支付依据，请由财务核对原发运与扣款记录后，在出库单操作中使用「核对补记支付凭据」补录；本次未再扣款，可返回单据列表')
    return rows.map(row => ({ id: Number(row.id), chargeNo: row.charge_no, chargeType: row.charge_type, amount: Number(row.amount), description: row.description || '', bizRef: order.outboundNo }))
  }

  /**
   * 财务人工核对历史发运实扣后补记支付凭据：只写凭据、不改余额、不重复扣款。
   * 补记后历史费用可正常对账（billingPaidChargeIds 认可逐笔分配依据），发运同步恢复入口可继续。
   */
  async verifyHistoricShipPayment(orderId: number, data: { clientRequestId?: string; reason?: string; confirmedTotal?: number }, operatorId?: number) {
    const clientRequestId = String(data?.clientRequestId || '').trim()
    if (!/^[0-9a-fA-F-]{36}$/.test(clientRequestId)) throw new BadRequestException('请提供有效的原核对操作标识，重新打开页面后重试')
    const reason = String(data?.reason || '').trim()
    if (reason.length < 2 || reason.length > 500) throw new BadRequestException('请填写 2 至 500 字的核对说明')
    const confirmedTotal = Number(data?.confirmedTotal)
    if (!Number.isFinite(confirmedTotal) || confirmedTotal < 0 || billingCents(confirmedTotal) > 999999999999) throw new BadRequestException('核对实扣合计金额无效，请按原发运扣款记录填写')
    const operator = Number(operatorId)
    if (!Number.isSafeInteger(operator) || operator <= 0) throw new BadRequestException('请重新登录后核对支付凭据')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM outbound_order WHERE id = ${BigInt(orderId)} FOR UPDATE`
      const order = await tx.outboundOrder.findUnique({ where: { id: BigInt(orderId) }, include: { items: true } })
      if (!order) throw new BadRequestException('出库单不存在，请返回列表重新选择')
      if (!order.shippedAt || !['shipped', 'delivered', 'partial_delivered', 'delivery_failed', 'exception'].includes(order.status)) {
        throw new BadRequestException('出库尚未完成发运，暂不能补记历史支付凭据；请先核对发运结果')
      }
      if (!order.customerId) throw new BadRequestException('该出库单没有客户费用，无需核对支付凭据')
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${order.customerId} FOR UPDATE`
      const customer = await tx.customer.findUnique({ where: { id: order.customerId } })
      if (!customer) throw new BadRequestException('发运客户不存在，请核对原单据')
      const rows: any[] = await tx.$queryRawUnsafe("SELECT * FROM billing_charge WHERE customer_id=? AND biz_ref=? AND source IN ('erp','wms') ORDER BY id", customer.id, order.outboundNo)
      if (!rows.length) throw new BadRequestException('没有需要核对的历史发运费用')
      const receipt = await tx.operationLog.findFirst({ where: { module: 'billing', action: 'outbound_payment', targetId: order.outboundNo }, orderBy: { id: 'desc' } })
      if (receipt) {
        const detail: any = receipt.detail || {}
        if (detail.clientRequestId === clientRequestId) {
          return { duplicate: true, outboundNo: order.outboundNo, totalAmount: detail.actualAmount, message: '原核对已完成，本次未重复写入凭据，也未改变余额' }
        }
        const allocations = Array.isArray(detail.allocations) ? detail.allocations : []
        const complete = rows.every(row => allocations.some((a: any) => String(a.chargeId) === String(row.id) && billingCents(a.paidAmount) === billingCents(row.amount)))
        if (complete) throw new ConflictException('此出库单已有完整发运支付凭据，无需重复核对')
        throw new ConflictException('此出库单存在不完整的历史发运凭据，请先人工核对原始记录后再处理；本次未写入、未改余额')
      }
      const total = rows.reduce((n, c) => n + billingCents(c.amount), 0)
      if (billingCents(confirmedTotal) !== total) {
        throw new BadRequestException(`核对实扣合计 ¥${confirmedTotal.toFixed(2)} 与系统费用合计 ¥${(total / 100).toFixed(2)} 不一致，请先核对原发运扣款记录后重新填写`)
      }
      const balance = billingCents(customer.balance)
      const allocations = rows.map(row => ({ chargeId: Number(row.id), chargeNo: row.charge_no, chargeType: row.charge_type, paidAmount: Number(row.amount) }))
      await tx.operationLog.create({ data: { module: 'billing', action: 'outbound_payment', operatorId: BigInt(operator), targetType: 'outbound_order', targetId: order.outboundNo,
        detail: json({ clientRequestId, manualVerification: true, verificationReason: reason, customerId: Number(customer.id), outboundId: Number(order.id),
          preDeductAmount: null, actualAmount: total / 100, balanceBefore: balance / 100, balanceAfter: balance / 100, balanceDelta: 0,
          estimatedCharges: [], allocations,
          message: '财务已人工核对历史发运实扣并补记支付凭据；本次只记录凭据，未改余额、未重复扣款' }) } })
      return { outboundNo: order.outboundNo, verified: true, totalAmount: total / 100, allocations, balanceDelta: 0, message: '支付凭据已补记，历史发运费用已可正常对账；本次未改余额、未重复扣款' }
    })
  }
}
