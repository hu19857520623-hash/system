import { useSyncExternalStore } from 'react'
import { apiDelete, apiPut } from '../api/client'
import type { LegacyOrderStatus, OutboundOrder } from './mockData'
import { createErpOutbound, syncErpOutbounds, type ErpOutboundOrder } from '../api/erp'
import { getCustomerCode } from './dataScope'
import { toErpTakealotDestWh, fromErpTakealotDestWh } from './takealotDocParser'
import { getPriceTemplateForCustomer } from './feeTemplateStore'
import { buildOutboundTemplateSnapshot } from './feeTemplates'

let orders: OutboundOrder[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

function persist(next: OutboundOrder[]) {
  orders = next
  emit()
  void apiPut('/outbound-orders', next).catch(err => console.error('persist outbound failed', err))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return orders
}

export function hydrateOutbound(next: OutboundOrder[]) {
  orders = structuredClone(next)
  emit()
}

export function getOutboundOrders(): OutboundOrder[] {
  return orders
}

export function addOutboundOrder(order: OutboundOrder) {
  persist([order, ...orders])
}

export async function addOutboundOrderOrThrow(order: OutboundOrder) {
  const before = orders
  const existingIndex = orders.findIndex(item => item.id === order.id || item.outboundNo === order.outboundNo)
  const next = existingIndex >= 0
    ? orders.map((item, index) => index === existingIndex ? { ...item, ...order } : item)
    : [order, ...orders]
  orders = next
  emit()
  try {
    await apiPut('/outbound-orders', next)
  } catch (error) {
    orders = before
    emit()
    throw error
  }
}

export async function removeOutboundOrder(id: string) {
  const before = orders
  const target = orders.find(order => order.id === id)
  orders = orders.filter(order => order.id !== id)
  emit()
  try {
    if (target) {
      await apiDelete(`/outbound-orders/${encodeURIComponent(target.outboundNo)}`)
    }
  } catch (error) {
    orders = before
    emit()
    throw error
  }
}

export function updateOutboundOrder(id: string, patch: Partial<OutboundOrder>) {
  persist(orders.map(o => (o.id === id ? { ...o, ...patch } : o)))
}

export function useOutboundOrders(): OutboundOrder[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function nextOutboundNo(): string {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const seq = String(orders.length + 1).padStart(3, '0')
  return `OUT-${date}${seq}`
}

export function resetOutboundOrders(seed: OutboundOrder[]) {
  persist(structuredClone(seed))
}

function mapErpOutboundStatus(omsStatus: string): LegacyOrderStatus {
  const allowed: LegacyOrderStatus[] = ['pending', 'locked', 'picking', 'shipped', 'delivered', 'exception']
  return (allowed.includes(omsStatus as LegacyOrderStatus) ? omsStatus : 'locked') as LegacyOrderStatus
}

export function applyErpOutboundToLocal(erp: ErpOutboundOrder, base?: Partial<OutboundOrder>): OutboundOrder {
  const existing = orders.find(o => o.outboundNo === erp.outboundNo)
  const takealotDest = fromErpTakealotDestWh(erp.fbaWarehouse)
  const order: OutboundOrder = {
    id: existing?.id || `erp-ob-${erp.id}`,
    customerId: base?.customerId || existing?.customerId,
    outboundNo: erp.outboundNo,
    source: (erp.source as OutboundOrder['source']) || base?.source || existing?.source || (erp.stockSource === 'catalog' ? 'catalog_dist' : 'platform_order'),
    stockSource: erp.stockSource || base?.stockSource || existing?.stockSource || (base?.source === 'catalog_dist' ? 'catalog' : 'owned'),
    refNo: existing?.refNo || base?.refNo || erp.fbaNo || undefined,
    orderNo: erp.orderNo || existing?.orderNo || base?.orderNo || undefined,
    type: base?.type || existing?.type || (erp.platform === 'Takealot' ? 'takealot' : 'dropship'),
    warehouse: erp.warehouseCode?.toLowerCase().includes('jhb') ? 'jhb1' : (existing?.warehouse || 'jhb1'),
    items: erp.items?.length || existing?.items || 1,
    totalQty: erp.items?.reduce((s, i) => s + i.qty, 0) || existing?.totalQty || 0,
    status: mapErpOutboundStatus(erp.omsStatus),
    destination: erp.destination || base?.destination || existing?.destination || '—',
    createdAt: existing?.createdAt || new Date().toISOString().slice(0, 10),
    trackingNo: erp.trackingNo || existing?.trackingNo,
    shippingMethod: erp.shippingMethod || existing?.shippingMethod || base?.shippingMethod,
    recipient: erp.recipient || existing?.recipient || base?.recipient,
    scheduledDeliveryDate: existing?.scheduledDeliveryDate || base?.scheduledDeliveryDate || erp.appointmentDate || undefined,
    sellerStoreName: existing?.sellerStoreName || base?.sellerStoreName || erp.sellerStoreName || undefined,
    takealotDestWarehouse: takealotDest || existing?.takealotDestWarehouse || base?.takealotDestWarehouse,
    takealotSellerId: existing?.takealotSellerId || base?.takealotSellerId || erp.takealotSellerId || undefined,
    takealotBookingRef: existing?.takealotBookingRef || base?.takealotBookingRef || erp.takealotBookingRef || undefined,
    shipmentDueDate: existing?.shipmentDueDate || base?.shipmentDueDate || erp.shipmentDueDate || undefined,
    remark: erp.remark || existing?.remark || base?.remark || undefined,
    lineItems: erp.items?.map(i => ({
      sku: i.sku,
      name: i.productName || i.sku,
      qty: i.qty,
    })) || existing?.lineItems,
    attachments: existing?.attachments || base?.attachments,
    preDeductFees: existing?.preDeductFees || base?.preDeductFees,
    destRegion: erp.preDeduct?.destRegion || erp.destRegion || existing?.destRegion || base?.destRegion,
    priceTemplateId: erp.preDeduct?.priceTemplateId || existing?.priceTemplateId || base?.priceTemplateId,
    priceTemplateName: erp.preDeduct?.priceTemplateName || existing?.priceTemplateName || base?.priceTemplateName,
    preDeductTotal: erp.preDeduct?.preDeductTotal ?? existing?.preDeductTotal ?? base?.preDeductTotal,
    preDeductVolumeM3: erp.preDeduct?.totalVolumeM3 ?? existing?.preDeductVolumeM3 ?? base?.preDeductVolumeM3,
    preDeductWeightKg: erp.preDeduct?.totalWeightKg ?? existing?.preDeductWeightKg ?? base?.preDeductWeightKg,
    actualFeesTotal: erp.actualFees?.actualTotal ?? existing?.actualFeesTotal,
    measuredVolumeM3: erp.measure?.totalVolumeM3 ?? existing?.measuredVolumeM3,
    measuredWeightKg: erp.measure?.totalWeightKg ?? existing?.measuredWeightKg,
    measure: erp.measure ?? existing?.measure,
    actualFees: erp.actualFees ?? existing?.actualFees,
    settlementStatus: existing?.settlementStatus,
    settlementDelta: existing?.settlementDelta ?? undefined,
  }
  if (erp.preDeduct?.lines?.length && !(existing?.preDeductFees?.length || base?.preDeductFees?.length)) {
    order.preDeductFees = erp.preDeduct.lines.map(l => ({
      type: l.type,
      amount: l.amount,
      label: l.label,
      detail: l.detail,
    }))
  }
  const idx = orders.findIndex(o => o.outboundNo === order.outboundNo || o.id === order.id)
  if (idx >= 0) {
    const next = [...orders]
    next[idx] = { ...next[idx], ...order }
    persist(next)
  } else {
    persist([order, ...orders])
  }
  return order
}

export async function submitOutboundToErp(
  order: OutboundOrder,
): Promise<{ ok: true; order: OutboundOrder } | { ok: false; error: string }> {
  const customerCode = getCustomerCode(order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '当前角色未绑定客户编码，无法同步 ERP' }
  }
  try {
    const now = new Date().toISOString()
    const preDeductLines = (order.preDeductFees || []).map(f => ({
      type: f.type,
      label: ('label' in f && f.label) ? String(f.label) : f.type,
      amount: f.amount,
      detail: ('detail' in f && f.detail) ? String(f.detail) : undefined,
    }))
    const preDeductTotal = order.preDeductTotal ?? preDeductLines.reduce((s, l) => s + l.amount, 0)
    let templateSnapshot = undefined
    if (order.destRegion && order.customerId) {
      const tpl = getPriceTemplateForCustomer(order.customerId, order.destRegion)
      templateSnapshot = buildOutboundTemplateSnapshot(
        tpl,
        order.destRegion,
        String(order.shippingMethod || '卡派'),
      )
    }
    const erp = await createErpOutbound({
      outboundNo: order.outboundNo,
      customerCode,
      customerId: order.customerId,
      warehouseCode: 'WMS-JHB-01',
      platform: order.type === 'takealot' ? 'Takealot' : undefined,
      fbaNo: order.refNo,
      appointmentDate: order.scheduledDeliveryDate,
      shipmentDueDate: order.shipmentDueDate,
      takealotBookingRef: order.takealotBookingRef,
      sellerStoreName: order.sellerStoreName,
      takealotSellerId: order.takealotSellerId,
      shippingMethod: order.shippingMethod,
      destination: order.destination,
      source: order.source,
      orderNo: order.orderNo,
      recipient: order.recipient,
      remark: order.remark,
      stockSource: order.stockSource,
      destType: order.type === 'takealot' ? 'fba' : 'local',
      fbaWarehouse: order.takealotDestWarehouse
        ? toErpTakealotDestWh(order.takealotDestWarehouse)
        : undefined,
      items: (order.lineItems || []).map(l => ({
        sku: l.sku,
        qty: l.qty,
        productName: l.name,
      })),
      attachments: (order.attachments || []).map(a => ({
        fileType: a.fileType || a.kind || 'other',
        fileName: a.fileName,
        url: a.url,
        sku: a.sku,
        platformBarcode: a.platformBarcode,
        unitIndex: a.unitIndex,
        sourcePage: a.sourcePage,
        sourceRow: a.sourceRow,
        sourceColumn: a.sourceColumn,
        labelRole: a.labelRole,
      })),
      preDeduct: preDeductLines.length ? {
        destRegion: order.destRegion,
        priceTemplateId: order.priceTemplateId,
        priceTemplateName: order.priceTemplateName,
        preDeductTotal,
        totalVolumeM3: order.preDeductVolumeM3,
        totalWeightKg: order.preDeductWeightKg,
        lines: preDeductLines,
        deductedAt: now,
        templateSnapshot,
      } : undefined,
    })
    return { ok: true, order: applyErpOutboundToLocal(erp, order) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function refreshOutboundsFromErp(customerId: string): Promise<number> {
  const customerCode = getCustomerCode(customerId)
  if (!customerCode || customerCode === '—') return 0
  const data = await syncErpOutbounds(customerCode)
  for (const item of data.items || []) {
    applyErpOutboundToLocal(item, { customerId })
  }
  return data.total
}
