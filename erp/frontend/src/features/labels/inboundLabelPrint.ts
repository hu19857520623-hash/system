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

function splitQty(qty: number, parts: number) {
  const base = Math.floor(qty / parts)
  const rem = qty % parts
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0))
}

export function buildBoxLabelData(order: InboundLabelOrder): BoxLabelData[] {
  const lines = orderLines(order)
  const lineBoxNos = lines.map(l => Math.max(1, Number(l.boxNo) || 1))
  const maxLineBox = lineBoxNos.length ? Math.max(...lineBoxNos) : 1
  const boxTotal = Math.max(1, Number(order.boxCount) || 0, maxLineBox)
  const referenceNo = order.referenceNo?.trim() || order.inboundNo
  const warehouseCode = order.warehouseCode?.trim() || order.warehouse?.trim() || '—'
  const uniqueBoxes = new Set(lineBoxNos)
  const shouldSplit = uniqueBoxes.size === 1 && boxTotal > 1

  return Array.from({ length: boxTotal }, (_, i) => {
    const boxNo = i + 1
    const boxLines = shouldSplit
      ? lines
          .map(line => ({ ...line, qty: splitQty(Math.max(0, Number(line.qty) || 0), boxTotal)[i] }))
          .filter(line => line.qty > 0)
      : lines.filter(l => Math.max(1, Number(l.boxNo) || 1) === boxNo)
    return {
      referenceNo,
      boxNo,
      warehouseCode,
      origin: order.origin,
      boxIndex: boxNo,
      boxTotal,
      lines: boxLines.length
        ? boxLines.map(line => ({
            sku: lineSku(line, order),
            qty: Math.max(0, Number(line.qty) || 0),
          }))
        : [{ sku: '—', qty: 0 }],
    }
  })
}

export function buildInboundLabelInputs(order: InboundLabelOrder, _kind: InboundLabelKind): BarcodeLabelInput[] {
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
