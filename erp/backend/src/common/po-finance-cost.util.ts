/** 财务审核采购单时的成本拆分（写入成本台账） */

import { allocatePoDomesticFreight, type PoDomesticFreightOrder } from './po-domestic-freight.util'

export type PoFinanceCostLine = {
  id: bigint | number | string
  sku: string
  quantity: number
  unitPrice?: unknown
  domesticFreight?: unknown
}

export type PoFinanceCostConfirmation = {
  unitTax?: unknown
  logoTotalFee?: unknown
  cartonTotalPrice?: unknown
  spareCartonUnitPrice?: unknown
  spareCartonQty?: unknown
} | null

export type PoFinanceCostEntry = {
  costType: string
  amountRmb: number
  sku?: string
  remark?: string
}

export type PoFinanceCostBreakdown = {
  entries: PoFinanceCostEntry[]
  total: number
  productTotal: number
  domesticFreightTotal: number
  taxTotal: number
  logoTotal: number
  cartonTotal: number
  spareCartonTotal: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function posAmount(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? round2(n) : 0
}

export function computePoFinanceApprovalCosts(
  po: PoDomesticFreightOrder & { poNo?: string; items: PoFinanceCostLine[] },
  confirmation: PoFinanceCostConfirmation,
): PoFinanceCostBreakdown {
  const { perLine: lineDomesticMap } = allocatePoDomesticFreight(po)
  const poNo = po.poNo || ''
  const entries: PoFinanceCostEntry[] = []

  let productTotal = 0
  let domesticFreightTotal = 0
  let taxTotal = 0
  const unitTax = Number(confirmation?.unitTax || 0)

  for (const line of po.items) {
    const qty = Number(line.quantity) || 0
    const productCost = round2(qty * Number(line.unitPrice || 0))
    const domesticFreight = lineDomesticMap.get(String(line.id)) ?? 0
    const tax = round2(qty * unitTax)

    if (productCost > 0) {
      entries.push({ costType: '采购货款', amountRmb: productCost, sku: line.sku, remark: `采购单 ${poNo} · SKU ${line.sku}` })
      productTotal += productCost
    }
    if (domesticFreight > 0) {
      entries.push({ costType: '国内运费', amountRmb: domesticFreight, sku: line.sku, remark: `采购单 ${poNo} · SKU ${line.sku}` })
      domesticFreightTotal += domesticFreight
    }
    if (tax > 0) {
      entries.push({ costType: '采购税费', amountRmb: tax, sku: line.sku, remark: `采购单 ${poNo} · SKU ${line.sku}` })
      taxTotal += tax
    }
  }

  const logoTotal = posAmount(confirmation?.logoTotalFee)
  const cartonTotal = posAmount(confirmation?.cartonTotalPrice)
  const spareCartonTotal = posAmount(
    Number(confirmation?.spareCartonUnitPrice || 0) * Number(confirmation?.spareCartonQty || 0),
  )

  if (logoTotal > 0) {
    entries.push({ costType: 'Logo费用', amountRmb: logoTotal, remark: `采购单 ${poNo} · Logo 定制` })
  }
  if (cartonTotal > 0) {
    entries.push({ costType: '纸箱费用', amountRmb: cartonTotal, remark: `采购单 ${poNo} · 包装纸箱` })
  }
  if (spareCartonTotal > 0) {
    entries.push({ costType: '备用纸箱', amountRmb: spareCartonTotal, remark: `采购单 ${poNo} · 备用纸箱` })
  }

  const total = round2(productTotal + domesticFreightTotal + taxTotal + logoTotal + cartonTotal + spareCartonTotal)

  return {
    entries,
    total,
    productTotal: round2(productTotal),
    domesticFreightTotal: round2(domesticFreightTotal),
    taxTotal: round2(taxTotal),
    logoTotal,
    cartonTotal,
    spareCartonTotal,
  }
}

export function formatPoFinanceCostRemark(poNo: string, breakdown: PoFinanceCostBreakdown): string {
  const parts: string[] = [`采购单 ${poNo} 成本汇总（财务审核自动生成）`]
  if (breakdown.productTotal > 0) parts.push(`货款 ¥${breakdown.productTotal}`)
  if (breakdown.domesticFreightTotal > 0) parts.push(`国内运费 ¥${breakdown.domesticFreightTotal}`)
  if (breakdown.taxTotal > 0) parts.push(`税费 ¥${breakdown.taxTotal}`)
  if (breakdown.logoTotal > 0) parts.push(`Logo ¥${breakdown.logoTotal}`)
  if (breakdown.cartonTotal > 0) parts.push(`纸箱 ¥${breakdown.cartonTotal}`)
  if (breakdown.spareCartonTotal > 0) parts.push(`备用纸箱 ¥${breakdown.spareCartonTotal}`)
  parts.push(`合计 ¥${breakdown.total}`)
  return parts.join('；')
}
