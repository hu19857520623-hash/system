import type { InboundOrder, Product } from './mockData'
import { getCustomerCode } from './dataScope'
import { getInboundOrdersSnapshot } from './entityStore'
import {
  buildInboundReceivingListHtml,
  formatInboundListDateTime,
  groupReceivingListSkus,
  printInboundWarehouseCode,
  type InboundReceivingListDoc,
} from './inboundReceivingList'

function productBySku(products: Product[], sku: string) {
  const token = String(sku || '').trim().toUpperCase()
  return products.find((p) => {
    return [p.internalSku, p.customerSku, p.customCode]
      .map((value) => String(value || '').trim().toUpperCase())
      .includes(token)
  })
}

export function buildOmsReceivingListDoc(
  order: InboundOrder,
  products: Product[],
  allInbound: InboundOrder[] = [],
): InboundReceivingListDoc {
  const customerCode = getCustomerCode(order.customerId)
  const warehouse = printInboundWarehouseCode(order.warehouse)
  const completed = new Set(
    allInbound
      .filter((row) => row.id !== order.id
        && row.customerId === order.customerId
        && ['completed', 'shelved', 'partial'].includes(row.status))
      .flatMap((row) => (row.lineItems || []).map((line) => String(line.sku || '').trim().toUpperCase())),
  )
  const items = (order.lineItems?.length
    ? order.lineItems
    : [{ sku: order.skuHint || order.inboundNo, name: order.skuHint || '', qty: order.totalQty, boxNo: 1 }])
    .map((line) => {
      const product = productBySku(products, line.sku)
      return {
        sku: line.sku,
        name: line.name || product?.name || line.sku,
        expectedQty: line.qty,
        boxNo: line.boxNo,
        customCode: product?.customCode || '',
        firstArrival: !completed.has(String(line.sku || '').trim().toUpperCase()),
        weightKg: product?.weightKg ?? null,
        lengthCm: product?.lengthCm ?? null,
        widthCm: product?.widthCm ?? null,
        heightCm: product?.heightCm ?? null,
      }
    })

  return {
    inboundNo: order.inboundNo,
    createdAt: formatInboundListDateTime(order.createdAt),
    shipWarehouse: warehouse,
    destWarehouse: warehouse,
    customerCode,
    trackingNo: order.trackingNo || '',
    referenceNo: order.referenceNo || '',
    remark: order.remark || '',
    csRemark: order.remark || '',
    printedAt: formatInboundListDateTime(new Date()),
    skus: groupReceivingListSkus({ inboundNo: order.inboundNo, items }),
  }
}

export function printInboundReceivingList(order: InboundOrder, products: Product[]) {
  const html = buildInboundReceivingListHtml(
    buildOmsReceivingListDoc(order, products, getInboundOrdersSnapshot()),
  )
  const win = window.open('', '_blank', 'width=900,height=1100')
  if (!win) {
    window.alert('浏览器拦截了打印窗口，请允许弹出窗口后重试')
    return false
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  return true
}

export function downloadInboundReceivingList(order: InboundOrder, products: Product[]) {
  const html = buildInboundReceivingListHtml(
    buildOmsReceivingListDoc(order, products, getInboundOrdersSnapshot()),
  )
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `入库清单_${order.inboundNo}.html`
  anchor.click()
  URL.revokeObjectURL(url)
}
