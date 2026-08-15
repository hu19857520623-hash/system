import type { FeeRecord, OutboundOrder } from './mockData'

export type OutboundFeeSummary = {
  outboundNo: string
  preDeductTotal: number
  actualTotal: number
  settlementDelta: number | null
  settlementStatus: OutboundOrder['settlementStatus']
  preDeductVolumeM3?: number
  preDeductWeightKg?: number
  measuredVolumeM3?: number
  measuredWeightKg?: number
  cartons: NonNullable<OutboundOrder['measure']>['cartons']
  measuredAt?: string
  calculatedAt?: string
  preDeductLines: { label: string; amount: number; detail?: string }[]
  actualLines: { label: string; amount: number; desc: string }[]
  settlementLines: FeeRecord[]
  allRecords: FeeRecord[]
}

const OUTBOUND_NO_RE = /^OUT-/i

export function isOutboundRefNo(refNo: string): boolean {
  return OUTBOUND_NO_RE.test(String(refNo || '').trim())
}

/** P6-4：按出库单聚合预扣 / 实扣 / 对账流水 */
export function buildOutboundFeeSummary(
  outbound: OutboundOrder,
  feeRecords: FeeRecord[],
): OutboundFeeSummary {
  const outboundNo = outbound.outboundNo
  const related = feeRecords.filter(f => f.refNo === outboundNo)

  const preDeductRecords = related.filter(f => f.method === 'pre_deduct')
  const actualRecords = related.filter(f => f.method === 'actual')
  const settlementRecords = related.filter(
    f => f.method === 'settlement_adjust' || f.id.startsWith('settle-') || f.id.startsWith('refund-'),
  )

  const preDeductFromFees = preDeductRecords.reduce((s, f) => s + Math.abs(f.amount), 0)
  const preDeductTotal =
    outbound.preDeductTotal ??
    outbound.preDeductFees?.reduce((s, f) => s + f.amount, 0) ??
    preDeductFromFees

  const actualFromFees = actualRecords.reduce((s, f) => s + Math.abs(f.amount), 0)
  const actualTotal = outbound.actualFeesTotal ?? actualFromFees

  return {
    outboundNo,
    preDeductTotal,
    actualTotal,
    settlementDelta: outbound.settlementDelta ?? null,
    settlementStatus: outbound.settlementStatus,
    preDeductVolumeM3: outbound.preDeductVolumeM3,
    preDeductWeightKg: outbound.preDeductWeightKg,
    measuredVolumeM3: outbound.measuredVolumeM3,
    measuredWeightKg: outbound.measuredWeightKg,
    cartons: outbound.measure?.cartons || [],
    measuredAt: outbound.measure?.measuredAt,
    calculatedAt: outbound.actualFees?.calculatedAt,
    preDeductLines: (outbound.preDeductFees || []).map(f => ({
      label: f.label || f.type,
      amount: f.amount,
      detail: f.detail,
    })),
    actualLines: actualRecords.map(f => ({
      label:
        f.type === 'shipping' ? '物流费' :
        f.type === 'handling' ? '操作费' :
        f.type === 'relabel' ? '换标费' :
        f.type === 'picking' ? '拣货费' :
        f.type === 'inspection' ? '质检费' :
        f.type,
      amount: Math.abs(f.amount),
      desc: f.desc,
    })),
    settlementLines: settlementRecords,
    allRecords: related,
  }
}

export type OutboundFeeGroup = {
  outboundNo: string
  records: FeeRecord[]
  preDeductTotal: number
  actualTotal: number
  settlementAdjust: number
  netChange: number
  settled: boolean
}

/** 账单页：将流水按出库单分组 */
export function groupFeeRecordsByOutbound(feeRecords: FeeRecord[]): OutboundFeeGroup[] {
  const map = new Map<string, FeeRecord[]>()
  for (const f of feeRecords) {
    if (!isOutboundRefNo(f.refNo)) continue
    const list = map.get(f.refNo) || []
    list.push(f)
    map.set(f.refNo, list)
  }

  return [...map.entries()]
    .map(([outboundNo, records]) => {
      const preDeductTotal = records
        .filter(r => r.method === 'pre_deduct')
        .reduce((s, r) => s + Math.abs(r.amount), 0)
      const actualTotal = records
        .filter(r => r.method === 'actual')
        .reduce((s, r) => s + Math.abs(r.amount), 0)
      const settlementAdjust = records
        .filter(r => r.method === 'settlement_adjust')
        .reduce((s, r) => s + r.amount, 0)
      const netChange = records.reduce((s, r) => s + r.amount, 0)
      const settled = records.some(
        r => r.id.startsWith('settle-') || r.method === 'settlement_adjust',
      )
      return {
        outboundNo,
        records: records.sort((a, b) => b.date.localeCompare(a.date)),
        preDeductTotal,
        actualTotal,
        settlementAdjust,
        netChange,
        settled,
      }
    })
    .sort((a, b) => b.outboundNo.localeCompare(a.outboundNo))
}

export function settlementStatusLabel(status?: OutboundOrder['settlementStatus']): string {
  if (status === 'settled') return '已对账'
  if (status === 'refunded') return '已退还预扣'
  if (status === 'pending') return '待对账'
  return '—'
}
