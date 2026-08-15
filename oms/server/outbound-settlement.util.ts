/** P6-3：出库预扣 vs ERP 实算对账（Webhook / 本地复用） */

import type { PrismaClient } from '@prisma/client'

export type OutboundFeeCharge = {
  chargeNo: string
  id?: number
  chargeType: string
  amount: number
  description: string
  bizRef?: string | null
}

export type OutboundFeesPayload = {
  outboundNo: string
  preDeduct?: {
    destRegion?: string
    priceTemplateId?: string
    priceTemplateName?: string
    preDeductTotal: number
    totalVolumeM3?: number
    totalWeightKg?: number
    lines?: { type: string; label: string; amount: number; detail?: string }[]
    deductedAt?: string
    templateSnapshot?: Record<string, unknown>
  } | null
  actualFees?: {
    actualTotal: number
    lines?: { type: string; label: string; amount: number; detail?: string; chargeType?: string }[]
    calculatedAt?: string
  } | null
  measure?: {
    cartons?: {
      cartonNo: number
      lengthCm: number
      widthCm: number
      heightCm: number
      grossWeightKg: number
      volumeCbm: number
    }[]
    totalVolumeM3: number
    totalWeightKg: number
    measuredAt?: string
  } | null
  charges?: OutboundFeeCharge[]
  balance?: number | null
  status?: string
}

const CORE_CHARGE_TYPES = new Set(['handling', 'outbound_ship'])

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function mapChargeType(chargeType: string): string {
  if (chargeType === 'storage') return 'storage'
  if (chargeType === 'outbound_ship') return 'shipping'
  if (chargeType === 'relabel') return 'relabel'
  if (chargeType === 'picking') return 'picking'
  if (chargeType === 'inspection') return 'inspection'
  if (chargeType === 'other') return 'other'
  return 'handling'
}

export async function settleOutboundFees(
  prisma: PrismaClient,
  customerCode: string,
  customerId: string | null,
  data: OutboundFeesPayload,
): Promise<{ ok: true; settlementDelta: number; alreadySettled?: boolean } | { ok: false; error: string }> {
  const outboundNo = String(data.outboundNo || '').trim()
  if (!outboundNo) return { ok: false, error: '缺少 outboundNo' }

  const settleId = `settle-${outboundNo}`
  const existingSettle = await prisma.feeRecord.findUnique({ where: { id: settleId } })
  if (existingSettle) {
    const authoritativeBalance = data.balance == null ? Number.NaN : Number(data.balance)
    if (Number.isFinite(authoritativeBalance)) {
      const billing = customerId
        ? await prisma.billingAccount.findFirst({ where: { customerId } })
        : null
      if (billing) {
        await prisma.billingAccount.update({
          where: { id: billing.id },
          data: { creditBalance: round2(authoritativeBalance) },
        })
      }
    }
    return { ok: true, settlementDelta: 0, alreadySettled: true }
  }

  const charges = data.charges || []
  const preDeductRecords = await prisma.feeRecord.findMany({
    where: {
      refNo: outboundNo,
      method: 'pre_deduct',
      ...(customerCode ? { customerCode } : {}),
    },
  })
  const preDeductFromDb = round2(preDeductRecords.reduce((s, r) => s + Math.abs(r.amount), 0))
  const preDeductTotal = round2(Number(data.preDeduct?.preDeductTotal) || preDeductFromDb)
  const hasPreDeduct = preDeductTotal > 0
  const actualCoreTotal = round2(
    data.actualFees?.actualTotal ??
      charges.filter(c => CORE_CHARGE_TYPES.has(c.chargeType)).reduce((s, c) => s + Number(c.amount), 0),
  )
  const extraTotal = round2(
    charges.filter(c => !CORE_CHARGE_TYPES.has(c.chargeType)).reduce((s, c) => s + Number(c.amount), 0),
  )
  const actualGrandTotal = round2(actualCoreTotal + extraTotal)
  /** 余额调整：正=退还客户，负=补扣客户 */
  const settlementAdjustAmount = hasPreDeduct ? round2(preDeductTotal - actualGrandTotal) : 0
  /** 展示用：正=实扣多于预扣需补扣，负=实扣少于预扣需退还 */
  const settlementDelta = hasPreDeduct ? round2(actualGrandTotal - preDeductTotal) : 0
  const date = new Date().toISOString().slice(0, 10)

  const billing = customerId
    ? await prisma.billingAccount.findFirst({ where: { customerId } })
    : null
  const authoritativeBalance = data.balance == null ? Number.NaN : Number(data.balance)

  await prisma.$transaction(async tx => {
    for (const c of charges) {
      const feeId = c.id ? `erp-chg-${c.id}` : `erp-chg-${c.chargeNo}`
      const exists = await tx.feeRecord.findUnique({ where: { id: feeId } })
      if (exists) continue
      await tx.feeRecord.create({
        data: {
          id: feeId,
          date,
          type: mapChargeType(c.chargeType),
          refNo: c.bizRef || outboundNo,
          desc: c.description || c.chargeType,
          amount: -Math.abs(Number(c.amount) || 0),
          method: 'actual',
          customerCode: customerCode || null,
        },
      })
    }

    if (hasPreDeduct) {
      const desc =
        settlementAdjustAmount > 0
          ? `预扣对账退还 · ${outboundNo} · 预扣 ¥${preDeductTotal.toFixed(2)} 实扣 ¥${actualGrandTotal.toFixed(2)}`
          : settlementAdjustAmount < 0
            ? `预扣对账补扣 · ${outboundNo} · 预扣 ¥${preDeductTotal.toFixed(2)} 实扣 ¥${actualGrandTotal.toFixed(2)}`
            : `预扣对账平账 · ${outboundNo}`

      await tx.feeRecord.create({
        data: {
          id: settleId,
          date,
          type: 'handling',
          refNo: outboundNo,
          desc,
          amount: settlementAdjustAmount,
          method: 'settlement_adjust',
          customerCode: customerCode || null,
        },
      })
    }

    if (billing && Number.isFinite(authoritativeBalance)) {
      await tx.billingAccount.update({
        where: { id: billing.id },
        data: { creditBalance: round2(authoritativeBalance) },
      })
    } else if (billing && hasPreDeduct && settlementAdjustAmount !== 0) {
      await tx.billingAccount.update({
        where: { id: billing.id },
        data: { creditBalance: round2(billing.creditBalance + settlementAdjustAmount) },
      })
    }

    const ob = await tx.outboundOrder.findFirst({
      where: { outboundNo, ...(customerId ? { customerId } : {}) },
    })
    if (ob) {
      await tx.outboundOrder.update({
        where: { id: ob.id },
        data: {
          actualFeesTotal: actualGrandTotal,
          destRegion: data.preDeduct?.destRegion ?? ob.destRegion,
          priceTemplateId: data.preDeduct?.priceTemplateId ?? ob.priceTemplateId,
          priceTemplateName: data.preDeduct?.priceTemplateName ?? ob.priceTemplateName,
          preDeductTotal: preDeductTotal || ob.preDeductTotal,
          preDeductVolumeM3: data.preDeduct?.totalVolumeM3 ?? ob.preDeductVolumeM3,
          preDeductWeightKg: data.preDeduct?.totalWeightKg ?? ob.preDeductWeightKg,
          preDeductSnapshot: data.preDeduct ? JSON.stringify(data.preDeduct) : ob.preDeductSnapshot,
          measureSnapshot: data.measure ? JSON.stringify(data.measure) : ob.measureSnapshot,
          actualFeesSnapshot: data.actualFees ? JSON.stringify(data.actualFees) : ob.actualFeesSnapshot,
          settlementDelta,
          settlementStatus: 'settled',
          measuredVolumeM3: data.measure?.totalVolumeM3 ?? ob.measuredVolumeM3,
          measuredWeightKg: data.measure?.totalWeightKg ?? ob.measuredWeightKg,
          status: data.status === 'shipped' || data.status === 'delivered' ? data.status : ob.status,
        },
      })
    }

    const msgId = `erp-msg-fees-${outboundNo}`
    const msgExists = await tx.systemMessage.findUnique({ where: { id: msgId } })
    if (!msgExists) {
      const deltaLabel =
        settlementDelta > 0
          ? `补扣 ¥${settlementDelta.toFixed(2)}`
          : settlementDelta < 0
            ? `退还 ¥${Math.abs(settlementDelta).toFixed(2)}`
            : '无差额'
      await tx.systemMessage.create({
        data: {
          id: msgId,
          title: `出库 ${outboundNo} 费用已结算`,
          content: `实扣 ¥${actualGrandTotal.toFixed(2)}，预扣 ¥${preDeductTotal.toFixed(2)}，${deltaLabel}`,
          type: 'billing',
          read: false,
          createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        },
      })
    }
  })

  return { ok: true, settlementDelta }
}

export async function refundOutboundPreDeduct(
  prisma: PrismaClient,
  customerCode: string,
  customerId: string | null,
  data: { outboundNo: string; preDeductTotal?: number; balance?: number | null; reason?: string },
): Promise<{ ok: true; alreadyRefunded?: boolean } | { ok: false; error: string }> {
  const outboundNo = String(data.outboundNo || '').trim()
  if (!outboundNo) return { ok: false, error: '缺少 outboundNo' }

  const refundId = `refund-${outboundNo}`
  const existing = await prisma.feeRecord.findUnique({ where: { id: refundId } })
  if (existing) {
    const authoritativeBalance = data.balance == null ? Number.NaN : Number(data.balance)
    if (Number.isFinite(authoritativeBalance)) {
      const billing = customerId
        ? await prisma.billingAccount.findFirst({ where: { customerId } })
        : null
      if (billing) {
        await prisma.billingAccount.update({
          where: { id: billing.id },
          data: { creditBalance: round2(authoritativeBalance) },
        })
      }
    }
    return { ok: true, alreadyRefunded: true }
  }

  const settleId = `settle-${outboundNo}`
  const settled = await prisma.feeRecord.findUnique({ where: { id: settleId } })
  if (settled) return { ok: true, alreadyRefunded: true }

  const preDeductRecords = await prisma.feeRecord.findMany({
    where: {
      refNo: outboundNo,
      method: 'pre_deduct',
      ...(customerCode ? { customerCode } : {}),
    },
  })
  const preDeductTotal =
    round2(Number(data.preDeductTotal) || 0) ||
    round2(preDeductRecords.reduce((s, r) => s + Math.abs(r.amount), 0))

  if (preDeductTotal <= 0) return { ok: true }

  const billing = customerId
    ? await prisma.billingAccount.findFirst({ where: { customerId } })
    : null
  const authoritativeBalance = data.balance == null ? Number.NaN : Number(data.balance)

  const date = new Date().toISOString().slice(0, 10)
  const reason = data.reason === 'cancelled' ? '出库取消' : '预扣退还'

  await prisma.$transaction(async tx => {
    await tx.feeRecord.create({
      data: {
        id: refundId,
        date,
        type: 'handling',
        refNo: outboundNo,
        desc: `${reason} · 退还预扣 ¥${preDeductTotal.toFixed(2)}`,
        amount: preDeductTotal,
        method: 'settlement_adjust',
        customerCode: customerCode || null,
      },
    })

    if (billing) {
      await tx.billingAccount.update({
        where: { id: billing.id },
        data: {
          creditBalance: Number.isFinite(authoritativeBalance)
            ? round2(authoritativeBalance)
            : round2(billing.creditBalance + preDeductTotal),
        },
      })
    }

    const ob = await tx.outboundOrder.findFirst({ where: { outboundNo } })
    if (ob) {
      await tx.outboundOrder.update({
        where: { id: ob.id },
        data: {
          settlementStatus: 'refunded',
          settlementDelta: 0,
          status: 'cancelled',
        },
      })
    }
  })

  return { ok: true }
}
