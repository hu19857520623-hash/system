export type InboundFeeOperation = 'qc' | 'measure' | 'label' | 'putaway'

export type InboundFeeRuleLike = {
  id: number
  customerId: number | null
  warehouseCode: string | null
  qcUnitPrice: number
  measureUnitPrice: number
  labelUnitPrice: number
  putawayUnitPrice: number
  enabled: boolean
  effectiveFrom?: Date | null
  effectiveTo?: Date | null
}

export const INBOUND_FEE_CHARGE_TYPES: Record<InboundFeeOperation, string> = {
  qc: 'inbound_qc',
  measure: 'inbound_measure',
  label: 'inbound_label',
  putaway: 'inbound_putaway',
}

export const INBOUND_FEE_OP_LABELS: Record<InboundFeeOperation, string> = {
  qc: '清点',
  measure: '测量',
  label: '贴标',
  putaway: '上架',
}

export function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

export function inboundFeeRuleMatches(
  rule: InboundFeeRuleLike,
  customerId: number,
  warehouseCode: string,
  at = new Date(),
) {
  if (!rule.enabled) return false
  if (rule.effectiveFrom && at < startOfDay(rule.effectiveFrom)) return false
  if (rule.effectiveTo && at > endOfDay(rule.effectiveTo)) return false
  if (rule.customerId != null && Number(rule.customerId) !== Number(customerId)) return false
  if (rule.warehouseCode && rule.warehouseCode !== warehouseCode) return false
  return true
}

export function inboundFeeRuleSpecificity(rule: InboundFeeRuleLike) {
  return (rule.customerId != null ? 2 : 0) + (rule.warehouseCode ? 1 : 0)
}

export function pickInboundFeeRule(
  rules: InboundFeeRuleLike[],
  customerId: number,
  warehouseCode: string,
  at = new Date(),
) {
  const matched = rules.filter((rule) => inboundFeeRuleMatches(rule, customerId, warehouseCode, at))
  matched.sort((a, b) => inboundFeeRuleSpecificity(b) - inboundFeeRuleSpecificity(a) || b.id - a.id)
  return matched[0] || null
}

export function inboundFeeUnitPrice(rule: InboundFeeRuleLike, operation: InboundFeeOperation) {
  if (operation === 'qc') return Number(rule.qcUnitPrice || 0)
  if (operation === 'measure') return Number(rule.measureUnitPrice || 0)
  if (operation === 'label') return Number(rule.labelUnitPrice || 0)
  return Number(rule.putawayUnitPrice || 0)
}

export function inboundFeeIdempotencyKey(inboundNo: string, operation: InboundFeeOperation) {
  return `inbound:${inboundNo}:${INBOUND_FEE_CHARGE_TYPES[operation]}`
}

export function buildInboundFeeCharge(input: {
  rule: InboundFeeRuleLike
  operation: InboundFeeOperation
  quantity: number
  inboundNo: string
}) {
  const quantity = Math.max(0, Math.floor(Number(input.quantity) || 0))
  const unitPrice = inboundFeeUnitPrice(input.rule, input.operation)
  const amount = roundMoney(unitPrice * quantity)
  if (!(amount > 0) || quantity <= 0) return null
  const chargeType = INBOUND_FEE_CHARGE_TYPES[input.operation]
  const opLabel = INBOUND_FEE_OP_LABELS[input.operation]
  return {
    chargeType,
    amount,
    quantity,
    unitPrice: roundMoney(unitPrice),
    operationType: input.operation,
    description: `入库${opLabel} · ${input.inboundNo} · ${quantity} ${input.operation === 'measure' ? 'SKU' : '件'}`,
    idempotencyKey: inboundFeeIdempotencyKey(input.inboundNo, input.operation),
    calcBasis: { operation: input.operation, quantity, unitPrice },
    ruleSnapshot: {
      ruleId: input.rule.id,
      customerId: input.rule.customerId,
      warehouseCode: input.rule.warehouseCode,
      unitPrice,
    },
  }
}
