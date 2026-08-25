export const RETURN_PROCESS_METHODS = {
  restock: '直接上架',
  pending_inspection: '检查拍照',
  relabel: '换标上架',
  other_issue: '等问题',
  destroy: '销毁',
} as const

export type ReturnProcessMethod = keyof typeof RETURN_PROCESS_METHODS

/** 允许「重新收货」修正实收/箱数的状态（会清除测体积与待确认费用） */
export const RETURN_RE_RECEIVE_STATUSES = ['received', 'measured', 'fee_calculated', 'arrived'] as const

export const RETURN_STATUS_LABELS: Record<string, string> = {
  pending_arrival: '在途',
  received: '已收货',
  measured: '已测体积',
  fee_calculated: '已算费',
  awaiting_customer: '待客户确认',
  accepted_pending: '待仓库作业',
  dispose_pending: '待销毁',
  arrived: '已到货',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已作废',
}

export const INSPECTION_RESULT_LABELS: Record<string, string> = {
  good: '良品',
  defective: '不良品',
  mixed: '混合',
  unknown: '待判定',
}

export const CUSTOMER_DECISION_LABELS: Record<string, string> = {
  pending: '待确认',
  keep: '留货',
  discard: '不留/销毁',
}

/** 退件费用默认价目（RMB，可按客户协议后续配置化） */
export const RETURN_FEE_CURRENCY = 'RMB' as const

export const RETURN_WAREHOUSES = ['JHB3', 'CPT2', 'DBN'] as const

export type ReturnWarehouse = (typeof RETURN_WAREHOUSES)[number]

/** 体积重(kg) = 长(cm) × 宽(cm) × 高(cm) ÷ 5000 */
export const RETURN_VOLUMETRIC_DIVISOR = 5000

/** 各仓退件物流费：按计费重(kg) × 单价；CPT2/DBN 8kg 起 */
export const RETURN_WAREHOUSE_LOGISTICS = {
  JHB3: { pricePerKg: 4, minBillableKg: 0 },
  CPT2: { pricePerKg: 6, minBillableKg: 8 },
  DBN: { pricePerKg: 7, minBillableKg: 8 },
} as const satisfies Record<ReturnWarehouse, { pricePerKg: number; minBillableKg: number }>

export const RETURN_FEE_RATES = {
  receiptPerOrder: 50,
  measurePerCarton: 15,
  inspectionPerOrder: 30,
  destroyBase: 40,
  destroyPerCbm: 80,
  repackPerUnit: 25,
  restockPerUnit: 20,
  relabelPerUnit: 15,
  pendingInspectionFee: 35,
  otherIssueFee: 45,
  decisionDeadlineHours: 72,
} as const

export const RETURN_FEE_CHARGE_TYPES = {
  return_logistics: '退件物流费',
  return_receipt: '退件收货费',
  return_measure: '退件测量费',
  return_handling: '退件操作费',
  return_inspection: '退件质检费',
  return_destroy: '退件销毁费',
  return_repack: '退件包装费',
  return_restock: '退件上架费',
  return_relabel: '退件换标费',
} as const

export function isValidProcessMethod(v: string): v is ReturnProcessMethod {
  return v in RETURN_PROCESS_METHODS
}

export function isValidInspectionResult(v: string) {
  return ['good', 'defective', 'mixed', 'unknown'].includes(v)
}

export function processMethodLabel(v?: string | null) {
  if (!v) return '—'
  return RETURN_PROCESS_METHODS[v as ReturnProcessMethod] || v
}

export function inspectionResultLabel(v?: string | null) {
  if (!v) return '—'
  return INSPECTION_RESULT_LABELS[v] || v
}

export function isValidReturnWarehouse(v: string): v is ReturnWarehouse {
  return (RETURN_WAREHOUSES as readonly string[]).includes(String(v || '').trim().toUpperCase())
}

export function returnWarehouseLabel(v?: string | null) {
  if (!v) return '—'
  return v
}

export function normalizeReturnWarehouse(v?: string | null): ReturnWarehouse | null {
  const s = String(v || '').trim().toUpperCase()
  if (s === 'JHB' || s === 'JHB3') return 'JHB3'
  if (isValidReturnWarehouse(s)) return s
  return null
}

export function getReturnLogisticsRates(warehouseCode?: string | null) {
  const wh = normalizeReturnWarehouse(warehouseCode)
  if (wh) return RETURN_WAREHOUSE_LOGISTICS[wh]
  return RETURN_WAREHOUSE_LOGISTICS.JHB3
}

export function computeReturnVolumetricWeightKg(lengthCm: number, widthCm: number, heightCm: number) {
  return (lengthCm * widthCm * heightCm) / RETURN_VOLUMETRIC_DIVISOR
}

export function returnLogisticsRateLabel(warehouseCode?: string | null) {
  const wh = normalizeReturnWarehouse(warehouseCode) || 'JHB3'
  const rates = RETURN_WAREHOUSE_LOGISTICS[wh]
  const minText = rates.minBillableKg > 0 ? `，${rates.minBillableKg}kg 起` : ''
  return `${wh} · ${rates.pricePerKg} RMB/kg${minText}`
}

/** 退件收费模板 · 计费方式 */
export const RETURN_FEE_CALC_MODES: Record<string, string> = {
  fixed: '固定/单',
  per_carton: '按箱数',
  per_sku: '按SKU件数',
  per_cbm: '按体积CBM',
  per_chargeable_weight: '按体积重kg',
}

export const RETURN_FEE_CALC_MODE_VALUES = Object.keys(RETURN_FEE_CALC_MODES)

export function isValidFeeCalcMode(v: string) {
  return RETURN_FEE_CALC_MODE_VALUES.includes(String(v || '').trim())
}

export function feeCalcModeLabel(v?: string | null) {
  if (!v) return '—'
  return RETURN_FEE_CALC_MODES[v] || v
}
