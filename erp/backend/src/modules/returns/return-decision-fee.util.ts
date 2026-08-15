import { RETURN_FEE_RATES } from './return.constants'
import type { ReturnProcessMethod } from './return.constants'

export type ReturnFeeLine = {
  chargeType: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/** 客户确认「不留」时的追加费用 */
export function buildDiscardFeeLines(totalVolumeCbm: number): ReturnFeeLine[] {
  const cbm = Math.max(totalVolumeCbm, 0.01)
  return [
    {
      chargeType: 'return_destroy',
      description: '退件销毁处理费',
      quantity: 1,
      unitPrice: RETURN_FEE_RATES.destroyBase,
      amount: RETURN_FEE_RATES.destroyBase,
    },
    {
      chargeType: 'return_destroy',
      description: `销毁体积费 · ${cbm.toFixed(4)} CBM`,
      quantity: 1,
      unitPrice: round2(cbm * RETURN_FEE_RATES.destroyPerCbm),
      amount: round2(cbm * RETURN_FEE_RATES.destroyPerCbm),
    },
  ]
}

/** 客户确认「留货」后按所选处理方式追加费用（测体积阶段仅收物流费） */
export function buildKeepFeeLines(
  processChoice: ReturnProcessMethod,
  totalQty: number,
): ReturnFeeLine[] {
  const qty = Math.max(1, totalQty)
  switch (processChoice) {
    case 'pending_inspection':
      return [
        {
          chargeType: 'return_inspection',
          description: '退件检查拍照费',
          quantity: 1,
          unitPrice: RETURN_FEE_RATES.inspectionPerOrder,
          amount: RETURN_FEE_RATES.inspectionPerOrder,
        },
      ]
    case 'restock':
      return [
        {
          chargeType: 'return_repack',
          description: `直接上架 · 包装费 × ${qty} 件`,
          quantity: qty,
          unitPrice: RETURN_FEE_RATES.repackPerUnit,
          amount: round2(qty * RETURN_FEE_RATES.repackPerUnit),
        },
        {
          chargeType: 'return_restock',
          description: `直接上架 · 上架费 × ${qty} 件`,
          quantity: qty,
          unitPrice: RETURN_FEE_RATES.restockPerUnit,
          amount: round2(qty * RETURN_FEE_RATES.restockPerUnit),
        },
      ]
    case 'relabel':
      return [
        {
          chargeType: 'return_relabel',
          description: `换标上架 · 换标费 × ${qty} 件`,
          quantity: qty,
          unitPrice: RETURN_FEE_RATES.relabelPerUnit,
          amount: round2(qty * RETURN_FEE_RATES.relabelPerUnit),
        },
        {
          chargeType: 'return_restock',
          description: `换标上架 · 上架费 × ${qty} 件`,
          quantity: qty,
          unitPrice: RETURN_FEE_RATES.restockPerUnit,
          amount: round2(qty * RETURN_FEE_RATES.restockPerUnit),
        },
      ]
    case 'other_issue':
      return [
        {
          chargeType: 'return_handling',
          description: '问题件处理费',
          quantity: 1,
          unitPrice: RETURN_FEE_RATES.otherIssueFee,
          amount: RETURN_FEE_RATES.otherIssueFee,
        },
      ]
    default:
      return []
  }
}

export const RETURN_DECISION_CHARGE_TYPES = [
  'return_inspection',
  'return_destroy',
  'return_repack',
  'return_restock',
  'return_relabel',
  'return_handling',
] as const

/** 测体积阶段仅写入退件物流费 */
export const RETURN_MEASURE_CHARGE_TYPES = ['return_logistics'] as const

export const RETURN_AUTO_CHARGE_TYPES = [...RETURN_MEASURE_CHARGE_TYPES] as const

export const RETURN_MANUAL_CHARGE_TYPES = ['return_extra'] as const

export const ALL_RETURN_CHARGE_TYPES = [
  ...RETURN_AUTO_CHARGE_TYPES,
  ...RETURN_MANUAL_CHARGE_TYPES,
  ...RETURN_DECISION_CHARGE_TYPES,
  'return_receipt',
  'return_measure',
] as const
