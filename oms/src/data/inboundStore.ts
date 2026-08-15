import type { DeliveryMethod, InboundOrder, InboundStatus, InboundType } from './mockData'
import {
  addInboundOrder as pushInbound,
  getInboundOrdersSnapshot,
  updateInboundOrder,
  upsertInboundOrder,
} from './entityStore'
import { createErpInbound, syncErpInbounds, type ErpInboundOrder } from '../api/erp'
import { getCustomerCode } from './dataScope'

export { pushInbound as addInboundOrder, updateInboundOrder, upsertInboundOrder }

export function nextInboundNo(): string {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const seq = String(getInboundOrdersSnapshot().length + 1).padStart(3, '0')
  return `IN-${date}${seq}`
}

function mapErpInboundStatus(omsStatus: string): InboundStatus {
  const allowed: InboundStatus[] = ['draft', 'receiving', 'partial', 'completed', 'exception', 'on_the_way', 'shelved']
  return (allowed.includes(omsStatus as InboundStatus) ? omsStatus : 'on_the_way') as InboundStatus
}

export function applyErpInboundToLocal(erp: ErpInboundOrder, customerId?: string): InboundOrder {
  const existing = getInboundOrdersSnapshot().find(o => o.inboundNo === erp.inboundNo)
  const order: InboundOrder = {
    id: existing?.id || `erp-ib-${erp.id}`,
    customerId: customerId || existing?.customerId,
    inboundNo: erp.inboundNo,
    source: erp.source || existing?.source || '客户自发',
    inboundType: (erp.inboundType as InboundType | null) || existing?.inboundType || '自发头程',
    deliveryMethod: (erp.deliveryMethod as DeliveryMethod | null) || existing?.deliveryMethod || 'self',
    stockSource: (erp.stockSource as InboundOrder['stockSource']) || existing?.stockSource || 'owned',
    boxCount: existing?.boxCount || erp.items.length || 1,
    skuCount: erp.items.length,
    totalQty: erp.totalExpectedQty,
    receivedQty: erp.totalReceivedQty,
    status: mapErpInboundStatus(erp.omsStatus),
    createdAt: existing?.createdAt || new Date().toISOString().slice(0, 10),
    eta: erp.eta || existing?.eta,
    warehouse: erp.warehouseCode || existing?.warehouse || 'jhb1',
    referenceNo: erp.referenceNo || existing?.referenceNo,
    trackingNo: erp.trackingNo || existing?.trackingNo,
    contact: erp.contact || existing?.contact,
    contactPhone: erp.contactPhone || existing?.contactPhone,
    remark: erp.remark || existing?.remark,
    lineItems: erp.items.map((i, index) => {
      const localLine = existing?.lineItems?.find(line => line.sku === i.sku)
      return {
        sku: i.sku,
        name: i.productName || localLine?.name || i.sku,
        qty: i.expectedQty,
        boxNo: localLine?.boxNo || index + 1,
        packType: localLine?.packType || '自带包装',
        stockType: localLine?.stockType || '以仓库为准',
      }
    }),
    attachments: existing?.attachments,
  }
  upsertInboundOrder(order)
  return order
}

/** 提交非草稿入库时推送 ERP ASN，并回写本地状态 */
export async function submitInboundToErp(order: InboundOrder): Promise<{ ok: true; order: InboundOrder } | { ok: false; error: string }> {
  const customerCode = getCustomerCode(order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '当前角色未绑定客户编码，无法同步 ERP' }
  }
  try {
    const erp = await createErpInbound({
      inboundNo: order.inboundNo,
      customerCode,
      customerId: order.customerId,
      warehouseCode: 'WMS-JHB-01',
      trackingNo: order.trackingNo,
      remark: order.remark,
      source: order.source,
      inboundType: order.inboundType,
      deliveryMethod: order.deliveryMethod,
      stockSource: order.stockSource,
      referenceNo: order.referenceNo,
      eta: order.eta,
      contact: order.contact,
      contactPhone: order.contactPhone,
      items: (order.lineItems || []).map(l => ({
        sku: l.sku,
        qty: l.qty,
        productName: l.name,
        boxNo: l.boxNo,
      })),
      attachments: (order.attachments || []).map(a => ({
        fileType: a.kind || 'other',
        fileName: a.fileName,
        url: a.url,
      })),
    })
    const merged = applyErpInboundToLocal(erp, order.customerId)
    return { ok: true, order: merged }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function refreshInboundsFromErp(customerId: string): Promise<number> {
  const customerCode = getCustomerCode(customerId)
  if (!customerCode || customerCode === '—') return 0
  const data = await syncErpInbounds(customerCode)
  for (const item of data.items || []) {
    applyErpInboundToLocal(item, customerId)
  }
  return data.total
}

export type { InboundOrder }
