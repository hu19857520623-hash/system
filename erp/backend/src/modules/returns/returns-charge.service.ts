import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { BillingService } from '../billing/billing.service'
import {
  ALL_RETURN_CHARGE_TYPES,
  RETURN_AUTO_CHARGE_TYPES,
  RETURN_DECISION_CHARGE_TYPES,
  RETURN_MANUAL_CHARGE_TYPES,
} from './return-decision-fee.util'

export type ReturnChargeInput = {
  customerId: number
  returnNo: string
  warehouseCode?: string
  source?: 'wms' | 'manual'
  chargeType: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

/** 退件计费入账（billing_charge 写入与清理） */
@Injectable()
export class ReturnsChargeService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  async createReturnCharge(data: ReturnChargeInput) {
    const customer = await this.prisma.customer.findUnique({ where: { id: BigInt(data.customerId) } })
    if (!customer) throw new NotFoundException('客户不存在')
    const suffix = await this.nextChargeSuffix(data.customerId)
    const prefix = customer.customerCode ? `${customer.customerCode}-` : ''
    const chargeNo = `${prefix}${suffix}`
    const chargeDate = new Date().toISOString().slice(0, 10)
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO billing_charge (charge_no, customer_id, charge_type, source, description, amount, quantity, unit_price, charge_date, biz_ref, source_ref, warehouse_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      chargeNo,
      BigInt(data.customerId),
      data.chargeType,
      data.source || 'wms',
      data.description,
      data.amount,
      data.quantity,
      data.unitPrice,
      chargeDate,
      data.returnNo,
      data.returnNo,
      data.warehouseCode || 'WMS-JHB-01',
    )
    void this.billing.pushCustomerBillingToOms(data.customerId)
  }

  async clearPendingAutoReturnCharges(returnNo: string) {
    const types = RETURN_AUTO_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  async clearPendingManualExtraCharges(returnNo: string) {
    const types = RETURN_MANUAL_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND source = 'manual'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  async clearPendingReturnCharges(returnNo: string) {
    const types = ALL_RETURN_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  async clearPendingDecisionCharges(returnNo: string) {
    const types = RETURN_DECISION_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  async refreshEstimatedFeeTotal(returnId: bigint, returnNo: string) {
    const rows: Array<{ total: unknown }> = await this.prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(amount), 0) as total FROM billing_charge WHERE biz_ref = ? AND status = 'pending'`,
      returnNo,
    )
    const total = Number(rows[0]?.total ?? 0)
    await this.prisma.returnOrder.update({
      where: { id: returnId },
      data: { estimatedFeeTotal: total, feeStatus: total > 0 ? 'estimated' : 'none' },
    })
    return total
  }

  async loadFeeLines(returnNo: string) {
    const types = ALL_RETURN_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    const rows: Array<{
      charge_type: string
      description: string
      quantity: number
      unit_price: number | null
      amount: number
      status: string
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT charge_type, description, quantity, unit_price, amount, status
       FROM billing_charge
       WHERE biz_ref = ? AND charge_type IN (${types})
       ORDER BY id ASC`,
      returnNo,
    )
    return rows.map((r) => ({
      chargeType: r.charge_type,
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      amount: Number(r.amount),
      status: r.status,
    }))
  }

  private async nextChargeSuffix(customerId: number): Promise<string> {
    const rows: Array<{ charge_no: string }> = await this.prisma.$queryRawUnsafe(
      'SELECT charge_no FROM billing_charge WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
      customerId,
    )
    const last = String(rows[0]?.charge_no || '')
    const match = last.match(/CHG-(\d+)$/)
    const next = match ? Number(match[1]) + 1 : 1
    return `CHG-${String(next).padStart(3, '0')}`
  }
}
