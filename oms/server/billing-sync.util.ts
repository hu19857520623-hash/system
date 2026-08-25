import type { PrismaClient } from '@prisma/client'
import { mapErpChargeType } from '../src/data/chargeType.js'

export type ErpBillingChargePayload = {
  id?: number
  chargeNo?: string
  chargeType?: string
  amount?: number
  description?: string
  bizRef?: string | null
  chargeDate?: string
}

export type ErpBillingRechargePayload = {
  rechargeNo?: string
  amount?: number
  paymentMethod?: string
  remark?: string | null
  createdAt?: string
}

export type ErpBillingChangedPayload = {
  balance?: number
  pendingBill?: number
  monthlySpent?: number
  billingNo?: string
  status?: string
  totalAmount?: number
  charges?: ErpBillingChargePayload[]
  recharges?: ErpBillingRechargePayload[]
  removeChargeIds?: number[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const raw = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10)
}

export function openPreDeductTotal(
  feeRecords: { id: string; method?: string | null; amount: number; refNo: string }[],
): number {
  const settledRefs = new Set(
    feeRecords
      .filter(
        r =>
          r.method === 'settlement_adjust' ||
          String(r.id).startsWith('settle-') ||
          String(r.id).startsWith('refund-'),
      )
      .map(r => r.refNo),
  )
  return round2(
    feeRecords
      .filter(r => r.method === 'pre_deduct' && !settledRefs.has(r.refNo))
      .reduce((sum, r) => sum + Math.abs(Number(r.amount) || 0), 0),
  )
}

export async function applyErpBillingChanged(
  prisma: PrismaClient,
  customerCode: string,
  account: { id: string; name: string; code: string; contact: string; warehouse: string } | null,
  data: ErpBillingChangedPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!account) return { ok: false, error: `OMS 无客户账户 ${customerCode}` }

  const balance = data.balance == null ? Number.NaN : Number(data.balance)
  const pendingBill = data.pendingBill == null ? Number.NaN : Number(data.pendingBill)
  const monthlySpent = data.monthlySpent == null ? Number.NaN : Number(data.monthlySpent)
  const billingId = `erp-billing-${customerCode.trim().toLowerCase()}`

  await prisma.$transaction(async tx => {
    const existing = await tx.billingAccount.findUnique({ where: { customerId: account.id } })
    const nextBalance = Number.isFinite(balance)
      ? round2(balance)
      : existing?.creditBalance ?? 0
    const nextPending = Number.isFinite(pendingBill)
      ? round2(pendingBill)
      : existing?.pendingBill ?? 0
    const nextMonthly = Number.isFinite(monthlySpent)
      ? round2(monthlySpent)
      : existing?.monthlySpent ?? 0

    if (existing) {
      await tx.billingAccount.update({
        where: { id: existing.id },
        data: {
          creditBalance: nextBalance,
          pendingBill: nextPending,
          monthlySpent: nextMonthly,
          name: account.name,
          code: account.code,
          contact: account.contact,
        },
      })
    } else {
      await tx.billingAccount.create({
        data: {
          id: billingId,
          customerId: account.id,
          name: account.name,
          code: account.code,
          contact: account.contact,
          warehouse: account.warehouse || 'jhb1',
          creditBalance: nextBalance,
          pendingBill: nextPending,
          monthlySpent: nextMonthly,
          budgetUsed: 0,
        },
      })
    }

    await tx.feeRecord.deleteMany({ where: { id: 'p0-upsert-probe' } })

    const removeIds = (data.removeChargeIds || [])
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0)
      .map(id => `erp-chg-${id}`)
    if (removeIds.length) {
      await tx.feeRecord.deleteMany({ where: { id: { in: removeIds } } })
    }

    for (const c of data.charges || []) {
      const chargeId = Number(c.id)
      if (!Number.isFinite(chargeId) || chargeId <= 0) continue
      const amount = Math.abs(Number(c.amount) || 0)
      if (!(amount > 0)) continue
      const feeId = `erp-chg-${chargeId}`
      const row = {
        date: toDateStr(c.chargeDate),
        type: mapErpChargeType(String(c.chargeType || '')),
        refNo: String(c.bizRef || c.chargeNo || '—'),
        desc: String(c.description || c.chargeType || ''),
        amount: -amount,
        method: 'actual' as const,
        customerCode,
      }
      await tx.feeRecord.upsert({
        where: { id: feeId },
        create: { id: feeId, ...row },
        update: row,
      })
    }

    for (const r of data.recharges || []) {
      const rechargeNo = String(r.rechargeNo || '').trim()
      const amount = Number(r.amount || 0)
      if (!rechargeNo || !(amount > 0)) continue
      const feeId = `erp-rc-${rechargeNo}`
      const row = {
        date: toDateStr(r.createdAt),
        type: 'recharge',
        refNo: rechargeNo,
        desc: String(r.remark || `ERP 充值到账 · ${String(r.paymentMethod || 'bank')}`),
        amount,
        method: 'actual' as const,
        customerCode,
        rechargeNo,
        paymentMethodTitle: String(r.paymentMethod || ''),
      }
      await tx.feeRecord.upsert({
        where: { id: feeId },
        create: { id: feeId, ...row },
        update: row,
      })
    }
  })

  return { ok: true }
}
