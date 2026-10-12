import { deriveCustomerCodeFromInternalSku } from '../../common/sku-code.util'

/** ERP 采购发运单：国内中转仓/采购来源，平台货盘明细；不接受 OMS 客户 ASN。 */
export function isCatalogPurchaseInbound(order: {
  sourceWarehouseCode?: string | null
  poId?: unknown
  omsCustomerCode?: string | null
  items: Array<{ sku: string }>
}): boolean {
  const customer = String(order.omsCustomerCode || '').trim().toUpperCase()
  if (customer && customer !== 'TKL') return false
  if (!order.sourceWarehouseCode?.trim() && !order.poId) return false
  if (!order.items.length) return false
  return order.items.every(item => {
    const owner = deriveCustomerCodeFromInternalSku(item.sku.trim().toUpperCase())
    return Boolean(item.sku.trim()) && (!owner || owner === 'TKL')
  })
}
