import type { InboundOrder } from './mockData'
import {
  buildBarcodeLabelsHtml,
  downloadBarcodeLabelHtml as downloadBarcodeHtml,
  printBarcodeLabels,
  resolveBarcodeLabelCode,
  type BarcodeLabelInput,
  type LabelCodeType,
} from './barcodeLabelTemplate'
import {
  buildBoxLabelsHtml,
  type BoxLabelData,
} from './boxLabelTemplate'
import { downloadBoxLabelsPdf } from './boxLabelPdf'
import { printSelectableBoxLabels } from './selectableBoxLabelPrint'
import { pageNotice } from '../utils/pageConfirm'

export type InboundLabelKind = '箱唛' | 'SKU 标签'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function lineSku(sku: string, customerCode?: string) {
  const value = sku.trim()
  const code = customerCode?.trim().toUpperCase()
  return code && value && !value.toUpperCase().startsWith(`${code}-`) ? `${code}-${value}` : value
}

function orderLines(order: InboundOrder) {
  return order.lineItems?.length
    ? order.lineItems
    : [{ sku: order.skuHint ?? '—', name: order.inboundNo, qty: order.totalQty, boxNo: 1, packType: '', stockType: '' }]
}

function splitQty(qty: number, parts: number) {
  const base = Math.floor(qty / parts)
  const rem = qty % parts
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0))
}

export function buildBoxLabelData(order: InboundOrder, customerCode?: string): BoxLabelData[] {
  const lines = orderLines(order)
  const byBox = new Map<number, typeof lines>()
  for (const line of lines) {
    const boxNo = Math.max(1, Number(line.boxNo) || 1)
    if (!byBox.has(boxNo)) byBox.set(boxNo, [])
    byBox.get(boxNo)!.push(line)
  }
  const shouldSplit = byBox.size === 1 && byBox.has(1) && order.boxCount > 1
  const boxNos = shouldSplit
    ? Array.from({ length: order.boxCount }, (_, index) => index + 1)
    : [...byBox.keys()].sort((a, b) => a - b)
  const boxTotal = boxNos.length
  const referenceNo = order.inboundNo.trim() || order.referenceNo?.trim() || ''
  const warehouseCode = order.warehouse?.trim() || '—'
  return boxNos.map((boxNo, i) => {
    const boxLines = shouldSplit
      ? lines
          .map(line => ({ ...line, qty: splitQty(Math.max(0, Number(line.qty) || 0), boxTotal)[i] }))
          .filter(line => line.qty > 0)
      : byBox.get(boxNo)!
    return {
      referenceNo,
      boxNo,
      warehouseCode,
      boxIndex: i + 1,
      boxTotal,
      lines: boxLines.length
        ? boxLines.map(line => ({
            sku: lineSku(line.sku, customerCode),
            qty: Math.max(0, Number(line.qty) || 0),
          }))
        : [{ sku: '—', qty: 0 }],
    }
  })
}

export function buildInboundLabelInputs(order: InboundOrder, _kind: InboundLabelKind, customerCode?: string): BarcodeLabelInput[] {
  const lines = orderLines(order)
  const inputs: BarcodeLabelInput[] = []

  for (const line of lines) {
    const code = resolveBarcodeLabelCode({ sku: line.sku, customerCode })
    if (!code) continue
    const count = Math.max(1, Math.min(line.qty, 500))
    inputs.push({ code, copies: count })
  }

  return inputs
}

export async function printInboundLabels(order: InboundOrder, kind: InboundLabelKind, customerCode?: string, codeType: LabelCodeType = 'qr') {
  if (kind === '箱唛') {
    const labels = buildBoxLabelData(order, customerCode)
    if (!labels.length) {
      pageNotice('没有可打印的箱唛')
      return false
    }
    return printSelectableBoxLabels(labels, codeType)
  }
  const inputs = buildInboundLabelInputs(order, kind, customerCode)
  if (!inputs.length) {
    pageNotice('没有可打印的标签')
    return false
  }
  return printBarcodeLabels(inputs, `${order.inboundNo}-${kind}`, codeType)
}

export async function downloadInboundLabelHtml(order: InboundOrder, kind: InboundLabelKind, customerCode?: string) {
  if (kind === '箱唛') {
    await downloadBoxLabelsPdf(buildBoxLabelData(order, customerCode), `${order.inboundNo}-${kind}`)
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
