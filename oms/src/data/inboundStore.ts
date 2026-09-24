import type { DeliveryMethod, InboundOrder, InboundStatus, InboundType } from './mockData'
import { isErpPalletInbound, sanitizeCustomerInboundType } from './mockData'
import {
  addInboundOrder as pushInbound,
  getInboundOrdersSnapshot,
  updateInboundOrder,
  upsertInboundOrder,
  upsertInboundOrderOrThrow,
} from './entityStore'
import { createErpInbound, updateErpInbound, cancelErpInbound, reactivateErpInbound, syncErpInbounds, type ErpInboundOrder } from '../api/erp'
import { getCustomerCode } from './dataScope'
import { findProductByCode } from './platformBindingUtils'
import { buildOmsAsnItem } from './omsAsnItem'
import { buildInboundNo, inboundNoPrefix, nextSeqFromNos } from './wmsDocNo'

export { pushInbound as addInboundOrder, updateInboundOrder, upsertInboundOrder }

export function canEditInboundOrder(status: InboundStatus) {
  return status === 'draft' || status === 'on_the_way'
}

export function canVoidInboundOrder(status: InboundStatus) {
  return status === 'draft' || status === 'on_the_way'
}

export function canReorderInboundOrder(status: InboundStatus) {
  return status === 'voided'
}

export function nextInboundNo(customerCode?: string): string {
  const prefix = inboundNoPrefix(customerCode)
  const seq = nextSeqFromNos(getInboundOrdersSnapshot().map(o => o.inboundNo), prefix)
  return buildInboundNo(customerCode, new Date(), seq)
}

function mapErpInboundStatus(omsStatus: string): InboundStatus {
  if (omsStatus === 'cancelled') return 'voided'
  const allowed: InboundStatus[] = ['draft', 'receiving', 'partial', 'completed', 'exception', 'on_the_way', 'shelved', 'voided']
  return (allowed.includes(omsStatus as InboundStatus) ? omsStatus : 'on_the_way') as InboundStatus
}

function lineItemsFromErpCartons(erp: ErpInboundOrder) {
  if (!erp.cartons?.length) return []
  return erp.cartons.flatMap((carton) => {
    const boxNo = Number(carton.boxSeq) > 0 ? Number(carton.boxSeq) : 1
    return (carton.items || []).map((item) => {
      const matched = erp.items.find((line) => line.sku === item.sku)
      return {
        sku: item.sku,
        name: matched?.productName || item.sku,
        qty: item.qty,
        boxNo,
        packType: '自带包装',
        stockType: '以仓库为准',
      }
    })
  })
}

export function buildInboundOrderFromErp(erp: ErpInboundOrder, customerId?: string): InboundOrder {
  const existing = getInboundOrdersSnapshot().find(o => o.inboundNo === erp.inboundNo)
  const cartonLines = lineItemsFromErpCartons(erp)
  const lineItems = cartonLines.length
    ? cartonLines
    : (existing?.lineItems?.length
      ? existing.lineItems
      : erp.items.map((i, index) => ({
          sku: i.sku,
          name: i.productName || i.sku,
          qty: i.expectedQty,
          boxNo: index + 1,
          packType: '自带包装',
          stockType: '以仓库为准',
        })))
  const boxCount = Math.max(
    erp.cartons?.length || 0,
    existing?.boxCount || 0,
    new Set(lineItems.map(line => Math.max(1, Number(line.boxNo) || 1))).size,
    1,
  )
  const order: InboundOrder = {
    id: existing?.id || `erp-ib-${erp.id}`,
    customerId: customerId || existing?.customerId,
    inboundNo: erp.inboundNo,
    source: erp.source || existing?.source || '客户自发',
    inboundType: sanitizeCustomerInboundType((erp.inboundType as InboundType | null) || existing?.inboundType),
    deliveryMethod: (erp.deliveryMethod as DeliveryMethod | null) || existing?.deliveryMethod || 'self',
    stockSource: 'owned',
    boxCount,
    skuCount: erp.items.length || new Set(lineItems.map(line => line.sku)).size,
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
    lineItems,
    attachments: existing?.attachments,
  }
  return order
}

export function applyErpInboundToLocal(erp: ErpInboundOrder, customerId?: string): InboundOrder {
  const order = buildInboundOrderFromErp(erp, customerId)
  upsertInboundOrder(order)
  return order
}

function erpAsnPayload(order: InboundOrder, customerCode: string) {
  return {
    inboundNo: order.inboundNo,
    customerCode,
    customerId: order.customerId,
    warehouseCode: 'WMS-JHB-01',
    trackingNo: order.trackingNo,
    remark: order.remark,
    source: order.source || '客户自发',
    inboundType: sanitizeCustomerInboundType(order.inboundType),
    deliveryMethod: order.deliveryMethod,
    stockSource: 'owned',
    referenceNo: order.referenceNo,
    eta: order.eta,
    contact: order.contact,
    contactPhone: order.contactPhone,
    items: (order.lineItems || []).map(line =>
      buildOmsAsnItem(line, findProductByCode(line.sku, order.customerId))),
    attachments: (order.attachments || []).map(a => ({
      fileType: a.kind || 'other',
      fileName: a.fileName,
      url: a.url,
    })),
  }
}

function mergeLocalInboundAfterErp(erp: ErpInboundOrder, local: InboundOrder): InboundOrder {
  const merged = buildInboundOrderFromErp(erp, local.customerId)
  return {
    ...merged,
    id: local.id || merged.id,
    warehouse: local.warehouse || merged.warehouse,
    lineItems: local.lineItems?.length ? local.lineItems : merged.lineItems,
    attachments: local.attachments ?? merged.attachments,
    remark: local.remark ?? merged.remark,
    source: local.source || merged.source,
  }
}

/** 提交非草稿入库时推送 ERP ASN，并回写本地状态 */
export async function submitInboundToErp(order: InboundOrder): Promise<{ ok: true; order: InboundOrder } | { ok: false; error: string }> {
  const customerCode = getCustomerCode(order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '当前角色未绑定客户编码，无法同步 ERP' }
  }
  try {
    const erp = await createErpInbound(erpAsnPayload(order, customerCode))
    const merged = mergeLocalInboundAfterErp(erp, order)
    await upsertInboundOrderOrThrow(merged)
    return { ok: true, order: merged }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 在途入库单修改后同步 ERP，并回写本地状态 */
export async function updateInboundOnErp(order: InboundOrder): Promise<{ ok: true; order: InboundOrder } | { ok: false; error: string }> {
  const customerCode = getCustomerCode(order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '当前角色未绑定客户编码，无法同步 ERP' }
  }
  try {
    const erp = await updateErpInbound(order.inboundNo, erpAsnPayload(order, customerCode))
    const merged = mergeLocalInboundAfterErp(erp, order)
    await upsertInboundOrderOrThrow(merged)
    return { ok: true, order: merged }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 草稿本地作废；在途单同步 ERP 后不再收货 */
export async function voidInboundOrder(order: InboundOrder): Promise<{ ok: true; order: InboundOrder } | { ok: false; error: string }> {
  if (!canVoidInboundOrder(order.status)) {
    return { ok: false, error: '仅草稿或在途入库单可作废' }
  }
  if (order.status === 'on_the_way') {
    const customerCode = getCustomerCode(order.customerId)
    if (!customerCode || customerCode === '—') {
      return { ok: false, error: '当前角色未绑定客户编码，无法同步 ERP' }
    }
    try {
      const erp = await cancelErpInbound(order.inboundNo, {
        customerCode,
        customerId: order.customerId,
      })
      const merged = {
        ...mergeLocalInboundAfterErp(erp, order),
        status: 'voided' as InboundStatus,
      }
      await upsertInboundOrderOrThrow(merged)
      return { ok: true, order: merged }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  const next = { ...order, status: 'voided' as InboundStatus }
  await upsertInboundOrderOrThrow(next)
  return { ok: true, order: next }
}

function isNotFoundError(err: unknown) {
  const status = err && typeof err === 'object' ? (err as { status?: number }).status : undefined
  const message = err instanceof Error ? err.message : String(err)
  return status === 404 || message.includes('不存在')
}

/** 作废单确认后重新下单：ERP 已取消则激活，否则按新 ASN 提交，进入在途 */
export async function reorderInboundOnErp(order: InboundOrder): Promise<{ ok: true; order: InboundOrder } | { ok: false; error: string }> {
  if (!canReorderInboundOrder(order.status)) {
    return { ok: false, error: '仅已作废的入库单可重新下单' }
  }
  if (!order.lineItems?.length) {
    return { ok: false, error: '请先确认入库货品后再提交' }
  }
  const customerCode = getCustomerCode(order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '当前角色未绑定客户编码，无法同步 ERP' }
  }
  const payload = erpAsnPayload(order, customerCode)
  try {
    let erp: ErpInboundOrder
    try {
      erp = await reactivateErpInbound(order.inboundNo, payload)
    } catch (err) {
      if (!isNotFoundError(err)) throw err
      erp = await createErpInbound(payload)
    }
    const merged = {
      ...mergeLocalInboundAfterErp(erp, order),
      status: 'on_the_way' as InboundStatus,
    }
    await upsertInboundOrderOrThrow(merged)
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
    if (isErpPalletInbound(item)) continue
    applyErpInboundToLocal(item, customerId)
  }
  return data.total
}

export type { InboundOrder }
