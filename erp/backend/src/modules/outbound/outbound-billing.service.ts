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
    if (!rows.length || rows.some(row => !paid.has(String(row.id)))) throw new ConflictException('历史发运费用缺少完整支付依据，请由财务核对原发运与扣款记录；本次未再扣款，可返回单据列表')
    return rows.map(row => ({ id: Number(row.id), chargeNo: row.charge_no, chargeType: row.charge_type, amount: Number(row.amount), description: row.description || '', bizRef: order.outboundNo }))
  }
}
