import {
  RETURN_FEE_RATES,
  getReturnLogisticsRates,
  returnLogisticsRateLabel,
  isValidFeeCalcMode,
} from './return.constants'
import type { ReturnFeeLine } from './return-measure.util'

export type FeeTemplateRule = {
  chargeType: string
  description: string
  calcMode: string
  unitPrice: number
  minQty: number | null
  sortOrder: number
  autoApply?: boolean
}

export type FeePreviewContext = {
  cartonCount: number
  totalVolumeCbm: number
  totalSkuQty: number
  totalChargeableWeightKg: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000
}

export function resolveReturnSkuQty(input: {
  receivedQty?: number | null
  items?: { quantity: number }[]
}): number {
  if (input.receivedQty != null && input.receivedQty > 0) return input.receivedQty
  return (input.items || []).reduce((s, i) => s + (i.quantity || 0), 0)
}

export function buildFeePreviewContext(input: {
  cartonCount: number
  totalVolumeCbm: number
  totalChargeableWeightKg: number
  receivedQty?: number | null
  items?: { quantity: number }[]
}): FeePreviewContext {
  return {
    cartonCount: input.cartonCount,
    totalVolumeCbm: input.totalVolumeCbm,
    totalChargeableWeightKg: input.totalChargeableWeightKg,
    totalSkuQty: resolveReturnSkuQty(input),
  }
}

/** 测体积阶段默认规则（仅用于初始化各仓模板，运行时以 DB 模板为准） */
export function defaultMeasureFeeRules(warehouseCode?: string | null): FeeTemplateRule[] {
  return [seedMeasureLogisticsRule(warehouseCode)]
}

function seedMeasureLogisticsRule(warehouseCode?: string | null): FeeTemplateRule {
  const rates = getReturnLogisticsRates(warehouseCode)
  return {
    chargeType: 'return_logistics',
    description: `退件物流费（${returnLogisticsRateLabel(warehouseCode)}）`,
    calcMode: 'per_chargeable_weight',
    unitPrice: rates.pricePerKg,
    minQty: rates.minBillableKg > 0 ? rates.minBillableKg : null,
    sortOrder: 1,
    autoApply: true,
  }
}

/** @deprecated 使用 defaultMeasureFeeRules */
export function defaultAutoFeeRules(): FeeTemplateRule[] {
  return defaultMeasureFeeRules()
}

/** 测体积阶段：按该仓库收费模板中 auto_apply 的规则逐项计费 */
export function buildMeasurePhaseFeeLines(
  ctx: FeePreviewContext,
  rules: FeeTemplateRule[],
): ReturnFeeLine[] {
  const active = (rules || []).filter((r) => r.autoApply !== false)
  if (!active.length) return []
  return buildAutoFeeLinesFromRules(active, ctx)
}

export function mapDbTemplateRules(
  dbRules: {
    chargeType: string
    description: string
    calcMode: string
    unitPrice: { toNumber?: () => number } | number
    minQty?: { toNumber?: () => number } | number | null
    sortOrder: number
    autoApply: boolean
  }[],
): FeeTemplateRule[] {
  const num = (v: { toNumber?: () => number } | number | null | undefined) => {
    if (v == null) return null
    if (typeof v === 'number') return v
    if (typeof v.toNumber === 'function') return v.toNumber()
    return Number(v)
  }
  return (dbRules || []).map((r) => ({
    chargeType: r.chargeType,
    description: r.description,
    calcMode: r.calcMode,
    unitPrice: num(r.unitPrice) ?? 0,
    minQty: num(r.minQty),
    sortOrder: r.sortOrder,
    autoApply: r.autoApply !== false,
  }))
}

export function buildAutoFeeLinesFromRules(
  rules: FeeTemplateRule[],
  ctx: FeePreviewContext,
): ReturnFeeLine[] {
  const sorted = [...rules]
    .filter((r) => r.autoApply !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const lines: ReturnFeeLine[] = []

  for (const rule of sorted) {
    if (!isValidFeeCalcMode(rule.calcMode)) continue

    if (rule.calcMode === 'fixed') {
      lines.push({
        chargeType: rule.chargeType,
        description: rule.description,
        quantity: 1,
        unitPrice: rule.unitPrice,
        amount: round2(rule.unitPrice),
      })
      continue
    }

    if (rule.calcMode === 'per_carton') {
      const qty = ctx.cartonCount
      if (qty <= 0) continue
      lines.push({
        chargeType: rule.chargeType,
        description: `${rule.description} × ${qty} 箱`,
        quantity: qty,
        unitPrice: rule.unitPrice,
        amount: round2(qty * rule.unitPrice),
      })
      continue
    }

    if (rule.calcMode === 'per_sku') {
      const qty = ctx.totalSkuQty
      if (qty <= 0) continue
      lines.push({
        chargeType: rule.chargeType,
        description: `${rule.description} × ${qty} 件`,
        quantity: qty,
        unitPrice: rule.unitPrice,
        amount: round2(qty * rule.unitPrice),
      })
      continue
    }

    if (rule.calcMode === 'per_cbm') {
      const min = rule.minQty ?? 0.01
      const cbm = Math.max(ctx.totalVolumeCbm, min)
      const amount = round2(cbm * rule.unitPrice)
      lines.push({
        chargeType: rule.chargeType,
        description: `${rule.description} · ${cbm.toFixed(4)} CBM`,
        quantity: 1,
        unitPrice: amount,
        amount,
      })
      continue
    }

    if (rule.calcMode === 'per_chargeable_weight') {
      const min = rule.minQty ?? 0
      const rawWeight = ctx.totalChargeableWeightKg
      const weight = Math.max(rawWeight, min)
      if (weight <= 0) continue
      const amount = round2(weight * rule.unitPrice)
      const minNote = min > 0 && rawWeight < min ? `（${min}kg 起）` : ''
      lines.push({
        chargeType: rule.chargeType,
        description: `${rule.description} · ${weight.toFixed(3)} kg × ${rule.unitPrice} RMB/kg${minNote}`,
        quantity: round3(weight),
        unitPrice: rule.unitPrice,
        amount,
      })
    }
  }
  return lines
}

export function normalizeExtraFeeLines(
  lines: { description?: string; amount?: number; quantity?: number; unitPrice?: number }[] | undefined,
): ReturnFeeLine[] {
  if (!lines?.length) return []
  return lines
    .map((line) => {
      const description = String(line.description || '').trim()
      const amount = round2(Number(line.amount))
      if (!description || amount <= 0) return null
      const quantity = line.quantity != null ? Number(line.quantity) : 1
      const unitPrice = line.unitPrice != null ? round2(Number(line.unitPrice)) : amount
      return {
        chargeType: 'return_extra',
        description,
        quantity: quantity > 0 ? quantity : 1,
        unitPrice,
        amount,
      }
    })
    .filter((line): line is ReturnFeeLine => line != null)
}

export function normalizeTemplateRulesInput(
  rules: {
    chargeType?: string
    description?: string
    calcMode?: string
    unitPrice?: number
    minQty?: number | null
    sortOrder?: number
    autoApply?: boolean
  }[],
): FeeTemplateRule[] {
  if (!Array.isArray(rules) || !rules.length) {
    throw new Error('请至少保留 1 条收费规则')
  }
  return rules.map((rule, index) => {
    const description = String(rule.description || '').trim()
    const calcMode = String(rule.calcMode || '').trim()
    const chargeType = String(rule.chargeType || 'return_handling').trim()
    const unitPrice = Number(rule.unitPrice)
    if (!description) throw new Error(`第 ${index + 1} 条规则缺少费用说明`)
    if (!isValidFeeCalcMode(calcMode)) throw new Error(`第 ${index + 1} 条规则计费方式无效`)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`第 ${index + 1} 条规则单价无效`)
    const minQtyRaw = rule.minQty as number | null | undefined | string
    const minQty = minQtyRaw != null && minQtyRaw !== '' ? Number(minQtyRaw) : null
    if (minQty != null && (!Number.isFinite(minQty) || minQty < 0)) {
      throw new Error(`第 ${index + 1} 条规则最低量无效`)
    }
    return {
      chargeType,
      description,
      calcMode,
      unitPrice: round2(unitPrice),
      minQty,
      sortOrder: rule.sortOrder != null ? Number(rule.sortOrder) : index + 1,
      autoApply: rule.autoApply !== false,
    }
  })
}
