import { downloadInboundLabelHtml, type InboundLabelLine, type InboundLabelOrder } from './inboundLabelPrint'

function poLineQty(line: { quantity?: number; plannedQty?: number }) {
  return Number(line?.quantity) > 0 ? Number(line.quantity) : Number(line?.plannedQty) || 0
}

export function buildPurchaseBoxLabelOrder(po: {
  poNo?: string
  warehouseName?: string
  warehouseCode?: string
  supplier?: string
  remark?: string
  customerCode?: string
  purchaseConfirmation?: { piecesPerCarton?: number | null }
  items?: Array<{ sku?: string; productName?: string; quantity?: number; plannedQty?: number; barcode?: string }>
}): InboundLabelOrder {
  const piecesPerCarton = Math.max(0, Number(po?.purchaseConfirmation?.piecesPerCarton) || 0)
  const lineItems: InboundLabelLine[] = []
  let boxNo = 1

  for (const line of po?.items || []) {
    const qty = poLineQty(line)
    const perBox = piecesPerCarton > 0 ? piecesPerCarton : Math.max(qty, 1)
    let remaining = qty > 0 ? qty : perBox

    do {
      lineItems.push({
        sku: line.sku || '—',
        name: line.productName || line.sku || '—',
        qty: Math.min(remaining, perBox),
        boxNo,
        barcode: line.barcode,
        customerCode: po.customerCode,
      })
      boxNo += 1
      remaining -= perBox
    } while (remaining > 0)
  }

  const boxCount = lineItems.length
    ? Math.max(...lineItems.map(item => item.boxNo ?? 1))
    : 1

  return {
    inboundNo: po.poNo || 'PO',
    warehouse: po.warehouseName || po.warehouseCode || '—',
    warehouseCode: po.warehouseCode || po.warehouseName || '—',
    referenceNo: po.poNo || '',
    trackingNo: po.remark || '',
    boxCount,
    customerCode: po.customerCode,
    lineItems: lineItems.length ? lineItems : undefined,
    totalQty: (po?.items || []).reduce((sum, line) => sum + poLineQty(line), 0),
  }
}

export function downloadPurchaseBoxLabels(po: Parameters<typeof buildPurchaseBoxLabelOrder>[0]) {
  downloadInboundLabelHtml(buildPurchaseBoxLabelOrder(po), '箱唛')
}
