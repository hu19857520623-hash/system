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

  async recordOperation(order: InboundForFee, operation: InboundFeeOperation, quantity: number) {
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
      return await this.billing.createCharge({
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
      })
    } catch (err) {
      console.warn(`[inbound-fee] ${order.inboundNo} ${operation} skipped:`, err)
      return null
    }
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
