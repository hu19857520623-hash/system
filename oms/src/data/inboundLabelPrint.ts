import type { InboundOrder } from './mockData'
import {
  buildBarcodeLabelsHtml,
  downloadBarcodeLabelHtml as downloadBarcodeHtml,
  printBarcodeLabels,
  resolveBarcodeLabelCode,
  type BarcodeLabelInput,
} from './barcodeLabelTemplate'
import {
  buildBoxLabelsHtml,
  downloadBoxLabelsHtml,
  printBoxLabels,
  type BoxLabelData,
} from './boxLabelTemplate'

export type InboundLabelKind = '箱唛' | 'SKU 标签'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function lineSku(sku: string, customerCode?: string) {
  return resolveBarcodeLabelCode({ sku, customerCode })
}

function orderLines(order: InboundOrder) {
  return order.lineItems?.length
    ? order.lineItems
    : [{ sku: order.skuHint ?? '—', name: order.inboundNo, qty: order.totalQty, boxNo: 1, packType: '', stockType: '' }]
}

export function buildBoxLabelData(order: InboundOrder, customerCode?: string): BoxLabelData[] {
  const lines = orderLines(order)
  const boxNos = [...new Set(lines.map(l => l.boxNo ?? 1))].sort((a, b) => a - b)
  const boxTotal = order.boxCount || boxNos.length || 1
  const referenceNo = order.referenceNo?.trim() || order.inboundNo
  const warehouseCode = order.warehouse?.trim() || '—'

  return boxNos.map((boxNo) => {
    const boxLines = lines.filter(l => (l.boxNo ?? 1) === boxNo)
    return {
      referenceNo,
      boxNo,
      warehouseCode,
      boxIndex: boxNo,
      boxTotal,
      lines: boxLines.map(line => ({
        sku: lineSku(line.sku, customerCode),
        qty: Math.max(0, Number(line.qty) || 0),
      })),
    }
  })
}

export function buildInboundLabelInputs(order: InboundOrder, kind: InboundLabelKind, customerCode?: string): BarcodeLabelInput[] {
  const lines = orderLines(order)
  const inputs: BarcodeLabelInput[] = []

  for (const line of lines) {
    const code = lineSku(line.sku, customerCode)
    if (!code) continue
    const count = Math.max(1, Math.min(line.qty, 500))
    inputs.push({ code, copies: count })
  }

  return inputs
}

export async function printInboundLabels(order: InboundOrder, kind: InboundLabelKind, customerCode?: string) {
  if (kind === '箱唛') {
    const labels = buildBoxLabelData(order, customerCode)
    if (!labels.length) {
      window.alert('没有可打印的箱唛')
      return false
    }
    return printBoxLabels(labels, `${order.inboundNo}-${kind}`)
  }
  const inputs = buildInboundLabelInputs(order, kind, customerCode)
  if (!inputs.length) {
    window.alert('没有可打印的标签')
    return false
  }
  return printBarcodeLabels(inputs, `${order.inboundNo}-${kind}`)
}

export function downloadInboundLabelHtml(order: InboundOrder, kind: InboundLabelKind, customerCode?: string) {
  if (kind === '箱唛') {
    downloadBoxLabelsHtml(buildBoxLabelData(order, customerCode), `${order.inboundNo}-${kind}`)
    return
  }
  const inputs = buildInboundLabelInputs(order, kind, customerCode)
  downloadBarcodeHtml(inputs, `${order.inboundNo}-${kind}`)
}

export async function buildInboundLabelHtml(order: InboundOrder, kind: InboundLabelKind, customerCode?: string) {
  if (kind === '箱唛') {
    return buildBoxLabelsHtml(buildBoxLabelData(order, customerCode), `${escapeHtml(order.inboundNo)}-${kind}`)
  }
  const inputs = buildInboundLabelInputs(order, kind, customerCode)
  return buildBarcodeLabelsHtml(inputs, `${escapeHtml(order.inboundNo)}-${kind}`)
}
