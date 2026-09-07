/** 批次库存单位成本：采购 + 海运 + 国内运费 */

function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function roundMoney(v: unknown): number {
  return Math.round(num(v) * 100) / 100
}

export type LotCostParts = {
  costRmb?: unknown
  seaFreightPerUnit?: unknown
  domesticFeePerUnit?: unknown
}

export function unitCostRmb(parts: LotCostParts): number {
  return roundMoney(
    roundMoney(parts.costRmb) + roundMoney(parts.seaFreightPerUnit) + roundMoney(parts.domesticFeePerUnit),
  )
}

export function lotBatchNo(inboundNo?: string | null): string | null {
  const value = String(inboundNo || '').trim()
  return value || null
}
