import {
  buildBarcodeLabelsHtml,
  downloadBarcodeLabelHtml as downloadBarcodeHtml,
  printBarcodeLabels,
  resolveBarcodeLabelCode,
  type BarcodeLabelInput,
} from './barcodeLabelTemplate'
import {
  buildBoxLabelsHtml,
  printBoxLabels,
  type BoxLabelData,
} from './boxLabelTemplate'
import { downloadBoxLabelsPdf } from './boxLabelPdf'

export type InboundLabelKind = '箱唛' | 'SKU 标签'

export interface InboundLabelLine {
  sku: string
  name: string
  qty: number
  boxNo?: number
  packType?: string
  stockType?: string
  customerCode?: string
  barcode?: string
}

export interface InboundLabelOrder {
  inboundNo: string
  warehouse: string
  warehouseCode?: string
  trackingNo?: string
  referenceNo?: string
  boxCount: number
  lineItems?: InboundLabelLine[]
  skuHint?: string
  totalQty?: number
  customerCode?: string
  origin?: string
}

function lineSku(line: InboundLabelLine, order: InboundLabelOrder) {
  return resolveBarcodeLabelCode({
    sku: line.sku,
    barcode: line.barcode,
    customerCode: line.customerCode || order.customerCode,
  })
}

function orderLines(order: InboundLabelOrder): InboundLabelLine[] {
  return order.lineItems?.length
    ? order.lineItems
    : [{
        sku: order.skuHint ?? '—',
        name: order.inboundNo,
        qty: order.totalQty ?? 1,
        boxNo: 1,
      }]
}

export function buildBoxLabelData(order: InboundLabelOrder): BoxLabelData[] {
  const lines = orderLines(order)
  const boxNos = [...new Set(lines.map(l => l.boxNo ?? 1))].sort((a, b) => a - b)
  const boxTotal = order.boxCount || boxNos.length || 1
  const referenceNo = order.referenceNo?.trim() || order.inboundNo
  const warehouseCode = order.warehouseCode?.trim() || order.warehouse?.trim() || '—'

  return boxNos.map((boxNo) => {
    const boxLines = lines.filter(l => (l.boxNo ?? 1) === boxNo)
    return {
      referenceNo,
      boxNo,
      warehouseCode,
      origin: order.origin,
      boxIndex: boxNo,
      boxTotal,
      lines: boxLines.map(line => ({
        sku: lineSku(line, order),
        qty: Math.max(0, Number(line.qty) || 0),
      })),
    }
  })
}

export function buildInboundLabelInputs(order: InboundLabelOrder, kind: InboundLabelKind): BarcodeLabelInput[] {
  const lines = orderLines(order)
  const inputs: BarcodeLabelInput[] = []

  for (const line of lines) {
    const code = lineSku(line, order)
    if (!code) continue
    const count = Math.max(1, Math.min(line.qty, 500))
    inputs.push({ code, copies: count })
  }

  return inputs
}

export async function buildInboundLabelHtml(order: InboundLabelOrder, kind: InboundLabelKind) {
  if (kind === '箱唛') {
    return buildBoxLabelsHtml(buildBoxLabelData(order), `${order.inboundNo}-${kind}`)
  }
  const inputs = buildInboundLabelInputs(order, kind)
  return buildBarcodeLabelsHtml(inputs, `${order.inboundNo}-${kind}`)
}

export async function printInboundLabels(order: InboundLabelOrder, kind: InboundLabelKind) {
  if (kind === '箱唛') {
    const labels = buildBoxLabelData(order)
    if (!labels.length) {
      window.alert('没有可打印的箱唛')
      return false
    }
    return printBoxLabels(labels, `${order.inboundNo}-${kind}`)
  }
  const inputs = buildInboundLabelInputs(order, kind)
  if (!inputs.length) {
    window.alert('没有可打印的标签')
    return false
  }
  return printBarcodeLabels(inputs, `${order.inboundNo}-${kind}`)
}

export async function downloadInboundLabels(order: InboundLabelOrder, kind: InboundLabelKind) {
  if (kind === '箱唛') {
    const labels = buildBoxLabelData(order)
    await downloadBoxLabelsPdf(labels, `${order.inboundNo}-${kind}`)
    return
  }
  const inputs = buildInboundLabelInputs(order, kind)
  downloadBarcodeHtml(inputs, `${order.inboundNo}-${kind}`)
}

/** @deprecated 请使用 downloadInboundLabels */
export async function downloadInboundLabelHtml(order: InboundLabelOrder, kind: InboundLabelKind) {
  return downloadInboundLabels(order, kind)
}
