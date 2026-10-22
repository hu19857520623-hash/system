const PROCESS_LABELS: Record<string, string> = {
  pending_inspection: '检查拍照',
  restock: '直接上架',
  relabel: '换标上架',
  other_issue: '等问题',
  destroy: '销毁',
}

const INSPECTION_LABELS: Record<string, string> = {
  good: '良品',
  defective: '不良品',
  mixed: '混合',
  unknown: '待判定',
}

function chineseLabel(value: string | undefined, label: string | undefined, labels: Record<string, string>) {
  if (value && Object.prototype.hasOwnProperty.call(labels, value)) return labels[value]
  if (label && /[\u4e00-\u9fff]/.test(label)) return label
  return value ? '待核对' : '—'
}

export function returnProcessLabel(value?: string, label?: string) {
  return chineseLabel(value, label, PROCESS_LABELS)
}

export function returnInspectionLabel(value?: string, label?: string) {
  return chineseLabel(value, label, INSPECTION_LABELS)
}

export function returnStatusLabel(value: string, label: string | undefined, labels: Record<string, string>) {
  return chineseLabel(value, label, labels)
}
