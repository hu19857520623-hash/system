import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { BillingService } from '../billing/billing.service'
import { PrismaService } from '../../common/prisma/prisma.service'
import {
  buildInboundFeeCharge,
  pickInboundFeeRule,
  type InboundFeeOperation,
  type InboundFeeRuleLike,
} from './inbound-fee.util'
import { UpsertInboundFeeRuleDto } from './dto/inbound-fee.dto'
import { Prisma } from '@prisma/client'

type InboundForFee = {
  inboundNo: string
  warehouseCode: string
  omsCustomerCode?: string | null
}

@Injectable()
export class InboundFeeService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  async listRules() {
    const rows = await this.prisma.inboundFeeRule.findMany({ orderBy: { id: 'desc' } })
    const customerIds = [...new Set(rows.map((row) => row.customerId).filter(Boolean))] as bigint[]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, customerCode: true, customerName: true },
        })
      : []
    const customerMap = new Map(customers.map((row) => [Number(row.id), row]))
    return rows.map((row) => this.present(row, customerMap.get(row.customerId ? Number(row.customerId) : -1)))
  }

  async options() {
    const [warehouses, customers] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { status: 1 },
        orderBy: { id: 'asc' },
        select: { warehouseCode: true, warehouseName: true, warehouseType: true },
      }),
      this.prisma.customer.findMany({
        where: { status: 1 },
        orderBy: { id: 'desc' },
        take: 300,
        select: { id: true, customerCode: true, customerName: true },
      }),
    ])
    return {
      warehouses: warehouses.map((row) => ({
        warehouseCode: row.warehouseCode,
        warehouseName: row.warehouseName,
        warehouseType: row.warehouseType,
      })),
      customers: customers.map((row) => ({
        id: Number(row.id),
        customerCode: row.customerCode,
        customerName: row.customerName,
        label: `${row.customerCode} ${row.customerName}`.trim(),
      })),
    }
  }

  async createRule(body: UpsertInboundFeeRuleDto, userId?: number) {
    const data = this.toWriteData(body, userId)
    const row = await this.prisma.inboundFeeRule.create({ data })
    return this.detail(Number(row.id))
  }

  async updateRule(id: number, body: UpsertInboundFeeRuleDto) {
    const existing = await this.prisma.inboundFeeRule.findUnique({ where: { id: BigInt(id) } })
    if (!existing) throw new NotFoundException('计费规则不存在')
    await this.prisma.inboundFeeRule.update({ where: { id: BigInt(id) }, data: this.toWriteData(body) })
    return this.detail(id)
  }

  async detail(id: number) {
    const row = await this.prisma.inboundFeeRule.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('计费规则不存在')
    const customer = row.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: row.customerId },
          select: { id: true, customerCode: true, customerName: true },
        })
      : null
    return this.present(row, customer)
  }

  async recordOperation(order: InboundForFee, operation: InboundFeeOperation, quantity: number, throwOnFailure = false) {
    try {
      const customerId = await this.resolveCustomerId(order.omsCustomerCode)
      if (!customerId) return null
      const rule = await this.resolveRule(customerId, order.warehouseCode)
      if (!rule) return null
      const charge = buildInboundFeeCharge({
        rule,
        operation,
        quantity,
        inboundNo: order.inboundNo,
      })
      if (!charge) return null
      const recorded = await this.billing.createCharge({
        customerId,
        chargeType: charge.chargeType,
        source: 'erp',
        description: charge.description,
        amount: charge.amount,
        quantity: charge.quantity,
        unitPrice: charge.unitPrice,
        bizRef: order.inboundNo,
        sourceRef: order.inboundNo,
        warehouseCode: order.warehouseCode,
        operationType: charge.operationType,
        idempotencyKey: charge.idempotencyKey,
        calcBasis: charge.calcBasis,
        ruleSnapshot: charge.ruleSnapshot,
      }, undefined, !throwOnFailure)
      if (throwOnFailure && !await this.billing.pushCustomerBillingToOms(customerId)) {
        throw new Error('入库费用已记录，OMS账单同步待核对')
      }
      return recorded
    } catch (err) {
      console.warn(`[inbound-fee] ${order.inboundNo} ${operation} skipped:`, err)
      if (throwOnFailure) throw err
      return null
    }
  }

  /** Distinct measured SKUs are cumulative; repeating one measurement is free.
   * Keep existing billed quantities (including legacy order-wide charges) as
   * credit, then append only the missing quantity under the customer/order locks. */
  async recordMeasuredSkus(order: InboundForFee) {
    const customerId = await this.resolveCustomerId(order.omsCustomerCode)
    if (!customerId) return null
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM customer WHERE id=${BigInt(customerId)} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM inbound_order WHERE inbound_no=${order.inboundNo} FOR UPDATE`
      const current = await tx.inboundOrder.findUnique({ where: { inboundNo: order.inboundNo }, include: { items: true } })
      if (!current || current.omsCustomerCode !== order.omsCustomerCode || current.warehouseCode !== order.warehouseCode) throw new BadRequestException('测量原单归属或仓库已变化，请核对后重试')
      const logs = await tx.operationLog.findMany({ where: { module: 'inbound', targetId: order.inboundNo, action: { in: ['measure_inbound', 'qc_measure'] } }, orderBy: { id: 'asc' } })
      const skus = new Set<string>()
      for (const log of logs) {
        const detail = log.detail as any
        const lines = log.action === 'measure_inbound' ? detail?.request?.measureItems : detail?.request?.items?.filter((line: any) => line.actualQty > 0)
        if (!Array.isArray(lines)) throw new BadRequestException('历史测量凭据不完整，请核对原测量记录，勿重新计费')
        for (const line of lines) {
          const item = current.items.find(item => String(item.id) === String(line.id))
          if (!item) throw new BadRequestException('测量凭据与商品明细不一致，请核对原单后重试')
          skus.add(item.sku)
        }
      }
      const key = `inbound:${order.inboundNo}:inbound_measure`
      const charges = await tx.billingCharge.findMany({ where: { customerId: BigInt(customerId), bizRef: order.inboundNo, chargeType: 'inbound_measure', source: 'erp', OR: [{ idempotencyKey: key }, { idempotencyKey: { startsWith: key + ':' } }] } })
      if (charges.some(row => row.status === 'cancelled')) throw new BadRequestException('测量费用存在已取消记录，请交财务核对后继续，勿重复收费')
      const billed = charges.reduce((sum, row) => sum + row.quantity, 0)
      if (billed >= skus.size) return { duplicate: true, measuredSkuCount: skus.size, billedSkuCount: billed }
      const rules = await tx.inboundFeeRule.findMany({ where: { enabled: true } })
      const rule = pickInboundFeeRule(rules.map(row => this.toRuleLike(row)), customerId, order.warehouseCode)
      if (!rule) return null
      const charge = buildInboundFeeCharge({ rule, operation: 'measure', quantity: skus.size - billed, inboundNo: order.inboundNo })
      if (!charge) return null
      return this.billing.createCharge({ ...charge, customerId, source: 'erp', bizRef: order.inboundNo, sourceRef: order.inboundNo, warehouseCode: order.warehouseCode,
        idempotencyKey: key + ':skus:' + skus.size, calcBasis: { ...charge.calcBasis, measuredSkus: [...skus].sort(), measuredSkuCount: skus.size, previouslyBilledSkuCount: billed } }, tx, false)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 })
    if (result && !await this.billing.pushCustomerBillingToOms(customerId)) throw new Error('入库测量费用已记录，OMS账单同步待核对')
    return result
  }

  private async resolveCustomerId(customerCode?: string | null) {
    const code = String(customerCode || '').trim()
    if (!code) return null
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code }, select: { id: true } })
    return customer ? Number(customer.id) : null
  }

  private async resolveRule(customerId: number, warehouseCode: string): Promise<InboundFeeRuleLike | null> {
    const rows = await this.prisma.inboundFeeRule.findMany({ where: { enabled: true } })
    return pickInboundFeeRule(
      rows.map((row) => this.toRuleLike(row)),
      customerId,
      warehouseCode,
    )
  }

  private toRuleLike(row: {
    id: bigint
    customerId: bigint | null
    warehouseCode: string | null
    qcUnitPrice: unknown
    measureUnitPrice: unknown
    labelUnitPrice: unknown
    putawayUnitPrice: unknown
    enabled: boolean
    effectiveFrom: Date | null
    effectiveTo: Date | null
  }): InboundFeeRuleLike {
    return {
      id: Number(row.id),
      customerId: row.customerId ? Number(row.customerId) : null,
      warehouseCode: row.warehouseCode,
      qcUnitPrice: Number(row.qcUnitPrice || 0),
      measureUnitPrice: Number(row.measureUnitPrice || 0),
      labelUnitPrice: Number(row.labelUnitPrice || 0),
      putawayUnitPrice: Number(row.putawayUnitPrice || 0),
      enabled: row.enabled,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    }
  }

  private present(
    row: {
      id: bigint
      ruleName: string
      customerId: bigint | null
      warehouseCode: string | null
      receiveUnitPrice: unknown
      receiveCartonPrice: unknown
      qcUnitPrice: unknown
      measureUnitPrice: unknown
      labelUnitPrice: unknown
      putawayUnitPrice: unknown
      enabled: boolean
      effectiveFrom: Date | null
      effectiveTo: Date | null
      createdAt: Date
      updatedAt: Date
    },
    customer?: { customerCode: string; customerName: string } | null,
  ) {
    return {
      id: Number(row.id),
      ruleName: row.ruleName,
      customerId: row.customerId ? Number(row.customerId) : null,
      customerCode: customer?.customerCode || '',
      customerName: customer?.customerName || '',
      warehouseCode: row.warehouseCode || '',
      receiveUnitPrice: Number(row.receiveUnitPrice || 0),
      receiveCartonPrice: Number(row.receiveCartonPrice || 0),
      qcUnitPrice: Number(row.qcUnitPrice || 0),
      measureUnitPrice: Number(row.measureUnitPrice || 0),
      labelUnitPrice: Number(row.labelUnitPrice || 0),
      putawayUnitPrice: Number(row.putawayUnitPrice || 0),
      enabled: row.enabled,
      effectiveFrom: row.effectiveFrom ? row.effectiveFrom.toISOString().slice(0, 10) : '',
      effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private toWriteData(body: UpsertInboundFeeRuleDto, userId?: number) {
    const ruleName = String(body.ruleName || '').trim()
    if (ruleName.length < 2) throw new BadRequestException('请填写规则名称')
    return {
      ruleName,
      customerId: body.customerId ? BigInt(body.customerId) : null,
      warehouseCode: body.warehouseCode?.trim() || null,
      receiveUnitPrice: body.receiveUnitPrice ?? 0,
      receiveCartonPrice: body.receiveCartonPrice ?? 0,
      qcUnitPrice: body.qcUnitPrice ?? 0,
      measureUnitPrice: body.measureUnitPrice ?? 0,
      labelUnitPrice: body.labelUnitPrice ?? 0,
      putawayUnitPrice: body.putawayUnitPrice ?? 0,
      enabled: body.enabled !== false,
      effectiveFrom: parseDate(body.effectiveFrom),
      effectiveTo: parseDate(body.effectiveTo),
      ...(userId ? { createdBy: BigInt(userId) } : {}),
    }
  }
}

function parseDate(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) throw new BadRequestException('生效日期格式为 YYYY-MM-DD')
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}
