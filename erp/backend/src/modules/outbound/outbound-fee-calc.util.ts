import type { OmsOutboundFeeTemplateSnapshot } from '../../common/oms-sync-meta.util'

export type OutboundActualFeeLine = {
  type: 'handling' | 'shipping'
  label: string
  amount: number
  detail: string
  chargeType: 'handling' | 'outbound_ship'
}

const DEFAULT_SNAPSHOT: OmsOutboundFeeTemplateSnapshot = {
  handling: { perOrderBase: 8, perUnit: 1.2, perSkuLine: 2 },
  shipping: { mode: 'volume', ratePerCbm: 580, minCharge: 30 },
  pickup: { perOrder: 12, perUnit: 0.8, minCharge: 10 },
  shippingMethod: '卡派',
  destRegion: 'jhb',
}

export function resolveFeeTemplateSnapshot(
  preDeductSnapshot?: OmsOutboundFeeTemplateSnapshot | null,
  meta?: { shippingMethod?: string; destRegion?: string },
): OmsOutboundFeeTemplateSnapshot {
  if (preDeductSnapshot?.handling && preDeductSnapshot?.shipping) {
    return {
      ...DEFAULT_SNAPSHOT,
      ...preDeductSnapshot,
      shippingMethod: preDeductSnapshot.shippingMethod || meta?.shippingMethod || DEFAULT_SNAPSHOT.shippingMethod,
      destRegion: preDeductSnapshot.destRegion || meta?.destRegion || DEFAULT_SNAPSHOT.destRegion,
    }
  }
  return {
    ...DEFAULT_SNAPSHOT,
    shippingMethod: meta?.shippingMethod || DEFAULT_SNAPSHOT.shippingMethod,
    destRegion: meta?.destRegion || DEFAULT_SNAPSHOT.destRegion,
  }
}

export function calculateOutboundActualFees(params: {
  totalVolumeM3: number
  totalWeightKg: number
  totalQty: number
  skuLineCount: number
  snapshot: OmsOutboundFeeTemplateSnapshot
}): { lines: OutboundActualFeeLine[]; total: number } {
  const { totalVolumeM3, totalWeightKg, totalQty, skuLineCount, snapshot } = params
  const destRegion = (snapshot.destRegion || 'jhb').toUpperCase()
  const shippingMethod = snapshot.shippingMethod || '卡派'
  const pickupOnly = shippingMethod === '自提'

  const handlingAmount = round2(
    snapshot.handling.perOrderBase
    + snapshot.handling.perUnit * totalQty
    + snapshot.handling.perSkuLine * skuLineCount,
  )

  const lines: OutboundActualFeeLine[] = [{
    type: 'handling',
    label: '操作费',
    amount: handlingAmount,
    detail: `实测 · 基础 ¥${snapshot.handling.perOrderBase} + ${totalQty} 件 × ¥${snapshot.handling.perUnit} + ${skuLineCount} SKU × ¥${snapshot.handling.perSkuLine}`,
    chargeType: 'handling',
  }]

  if (pickupOnly) {
    const pickup = snapshot.pickup || DEFAULT_SNAPSHOT.pickup!
    const amount = round2(Math.max(pickup.minCharge, pickup.perOrder + pickup.perUnit * totalQty))
    lines.push({
      type: 'shipping',
      label: '自提费',
      amount,
      detail: `实测 · ${destRegion} · 自提 · 基础 ¥${pickup.perOrder} + ${totalQty} 件 × ¥${pickup.perUnit}`,
      chargeType: 'outbound_ship',
    })
  } else {
    const channel = shippingMethod === '卡派' ? '卡派' : '快递'
    const rule = snapshot.shipping
    let amount = 0
    let detail = ''
    if (rule.mode === 'volume') {
      amount = round2(Math.max(rule.minCharge, totalVolumeM3 * (rule.ratePerCbm ?? 0)))
      detail = `实测 · ${destRegion} · ${channel} · 体积 ${totalVolumeM3.toFixed(4)} m³ × ¥${rule.ratePerCbm}/m³`
    } else {
      amount = round2(Math.max(rule.minCharge, totalWeightKg * (rule.ratePerKg ?? 0)))
      detail = `实测 · ${destRegion} · ${channel} · 重量 ${totalWeightKg.toFixed(2)} kg × ¥${rule.ratePerKg}/kg`
    }
    lines.push({
      type: 'shipping',
      label: '物流费',
      amount,
      detail,
      chargeType: 'outbound_ship',
    })
  }

  return { lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
