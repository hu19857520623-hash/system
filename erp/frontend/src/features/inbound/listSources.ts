export const INBOUND_SOURCE_LABELS = {
  all: '全部来源',
  pallet: '货盘',
  oms_customer: 'OMS 电商',
} as const

export type InboundSourceFilter = keyof typeof INBOUND_SOURCE_LABELS

export function inboundListSource(sourceKind?: string): Exclude<InboundSourceFilter, 'all'> {
  return sourceKind === 'oms_customer' ? 'oms_customer' : 'pallet'
}
