import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { BillingService } from '../billing/billing.service'
import {
  OUTBOUND_SHIP_BASE,
  PACK_UNIT_FEE,
  PICKING_UNIT_FEE,
  RELABEL_UNIT_FEE,
} from './outbound.policy'
import {
  parseOmsOutboundActualFees,
  parseOmsOutboundPreDeduct,
} from '../../common/oms-sync-meta.util'

export type OutboundShipCharge = {
  chargeNo: string
  id?: number
  chargeType: string
  amount: number
  description: string
  bizRef?: string | null
}

type OutboundOrderForBilling = {
  id: bigint
  outboundNo: string
  customerId: bigint | null
  warehouseCode: string
  destType: string
  remark: string | null
  needsRelabel: boolean
  relabelPrintCount: number
  items: Array<{ qty: number; pickedQty: number }>
}

@Injectable()
export class OutboundBillingService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  /** 发运时创建出库费用并处理 OMS 预扣差额 */
  async recordShipCharges(order: OutboundOrderForBilling): Promise<OutboundShipCharge[]> {
    const shipCharges: OutboundShipCharge[] = []
    if (!order.customerId) return shipCharges

    const actualFees = parseOmsOutboundActualFees(order.remark)
    const totalQty = order.items.reduce((s, i) => s + (i.pickedQty || i.qty), 0)
    const existingCharges = await this.billing.listChargesByBizRef(order.outboundNo)

    if (actualFees?.lines?.length && !existingCharges.length) {
      for (const line of actualFees.lines) {
        const created = await this.billing.createCharge({
          customerId: Number(order.customerId),
          chargeType: (line.chargeType as 'handling' | 'outbound_ship') || 'handling',
          source: 'erp',
          description: `${line.label} · ${order.outboundNo} · ${line.detail || '实测计费'}`,
          amount: line.amount,
          quantity: 1,
          unitPrice: line.amount,
          bizRef: order.outboundNo,
          sourceRef: order.outboundNo,
          warehouseCode: order.warehouseCode,
        })
        shipCharges.push(created)
      }
    } else if (existingCharges.length) {
      shipCharges.push(...existingCharges)
    } else {
      const pickingFee = Math.round(totalQty * PICKING_UNIT_FEE * 100) / 100
      const packFee = Math.round(totalQty * PACK_UNIT_FEE * 100) / 100
      shipCharges.push(
        await this.billing.createCharge({
          customerId: Number(order.customerId),
          chargeType: 'picking',
          source: 'erp',
          description: `出库拣货 · ${order.outboundNo} · ${totalQty} 件`,
          amount: pickingFee,
          quantity: totalQty,
          unitPrice: PICKING_UNIT_FEE,
          bizRef: order.outboundNo,
          sourceRef: order.outboundNo,
          warehouseCode: order.warehouseCode,
        }),
      )
      shipCharges.push(
        await this.billing.createCharge({
          customerId: Number(order.customerId),
          chargeType: 'handling',
          source: 'erp',
          description: `出库打包 · ${order.outboundNo}`,
          amount: packFee,
          quantity: totalQty,
          unitPrice: PACK_UNIT_FEE,
          bizRef: order.outboundNo,
          sourceRef: order.outboundNo,
          warehouseCode: order.warehouseCode,
        }),
      )
      shipCharges.push(
        await this.billing.createCharge({
          customerId: Number(order.customerId),
          chargeType: 'outbound_ship',
          source: 'erp',
          description: `出库运费 · ${order.outboundNo} → ${order.destType.toUpperCase()}`,
          amount: OUTBOUND_SHIP_BASE,
          quantity: 1,
          unitPrice: OUTBOUND_SHIP_BASE,
          bizRef: order.outboundNo,
          sourceRef: order.outboundNo,
          warehouseCode: order.warehouseCode,
        }),
      )
    }

    if (order.needsRelabel && !shipCharges.some((c) => c.chargeType === 'relabel')) {
      const printCount = order.relabelPrintCount > 0 ? order.relabelPrintCount : totalQty
      shipCharges.push(
        await this.billing.createCharge({
          customerId: Number(order.customerId),
          chargeType: 'relabel',
          source: 'erp',
          description: `换标作业 · ${order.outboundNo} · 按打印/扫码 ${printCount} 件`,
          amount: Math.round(printCount * RELABEL_UNIT_FEE * 100) / 100,
          quantity: printCount,
          unitPrice: RELABEL_UNIT_FEE,
          bizRef: order.outboundNo,
          sourceRef: order.outboundNo,
          warehouseCode: order.warehouseCode,
        }),
      )
    }

    const preDeductTotal = Math.max(
      0,
      Number(parseOmsOutboundPreDeduct(order.remark)?.preDeductTotal) || 0,
    )
    const actualGrandTotal =
      Math.round(shipCharges.reduce((sum, charge) => sum + Number(charge.amount || 0), 0) * 100) / 100
    const balanceDelta =
      Math.round((preDeductTotal > 0 ? preDeductTotal - actualGrandTotal : -actualGrandTotal) * 100) / 100
    if (balanceDelta !== 0) {
      await this.prisma.customer.update({
        where: { id: order.customerId },
        data: { balance: { increment: balanceDelta } },
      })
    }

    return shipCharges
  }
}
