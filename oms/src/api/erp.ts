import { apiGet, apiPost } from './client'
import type { OutboundRecipient } from '../data/mockData'

export type ErpCatalogItem = {
  sku: string
  customerCode: string
  customerSku: string
  productName: string
  spec: string | null
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  dimensionsSource: 'measured' | 'master' | null
  price: number
  catalogStockPool: number
  soldQty: number
  remainingStockQty: number
  visibleOnOms: boolean
  orderableOnOms: boolean
  syncedAt: string
}

export type ErpCustomer = {
  id: number
  customerCode: string
  customerName: string
  balance: number
  status: number
  statusLabel: string
  contactName: string | null
  contactPhone: string | null
}

export type ErpSkuHolding = {
  id: number
  customerId: number
  sku: string
  productName: string
  quantity: number
  unitPrice: number | null
  pricingId: number | null
  updatedAt: string
}

export type ErpPurchaseResult = {
  id: number
  orderNo: string
  customerId: number
  customerCode: string | null
  sku: string
  quantity: number
  unitPrice: number
  totalAmount: number
  balanceBefore: number | null
  balanceAfter: number | null
  status: string
  soldQty: number
  remainingStockQty: number
  catalogStockPool: number
  idempotent: boolean
  createdAt: string
}

export function getErpCatalog() {
  return apiGet<{ items: ErpCatalogItem[]; total: number; syncedAt: string }>('/erp/catalog')
}

export function getErpCatalogSku(sku: string) {
  return apiGet<ErpCatalogItem>(`/erp/catalog/${encodeURIComponent(sku)}`)
}

export function purchaseErpCatalog(body: {
  orderNo?: string
  customerCode?: string
  customerId?: string
  sku: string
  quantity: number
  unitPrice?: number
}) {
  return apiPost<ErpPurchaseResult>('/erp/purchase', body)
}

export function getErpCustomer(customerCode: string) {
  return apiGet<ErpCustomer>(`/erp/customers/${encodeURIComponent(customerCode)}`)
}

export function getErpBalance(customerCode: string) {
  return apiGet<{ customerCode: string; customerName: string; balance: number; status: string }>(
    `/erp/customers/${encodeURIComponent(customerCode)}/balance`,
  )
}

export function getErpSkuInventory(customerCode: string) {
  return apiGet<ErpSkuHolding[]>(`/erp/customers/${encodeURIComponent(customerCode)}/sku-inventory`)
}

export type ErpInboundOrder = {
  id: number
  inboundNo: string
  warehouseCode: string
  trackingNo: string | null
  status: string
  omsStatus: string
  totalExpectedQty: number
  totalReceivedQty: number
  source?: string | null
  inboundType?: string | null
  deliveryMethod?: string | null
  stockSource?: string | null
  referenceNo?: string | null
  eta?: string | null
  contact?: string | null
  contactPhone?: string | null
  remark?: string | null
  arrivedAt?: string | null
  receivedAt?: string | null
  putawayAt?: string | null
  items: { sku: string; expectedQty: number; receivedQty: number; productName?: string }[]
  idempotent?: boolean
}

export type ErpOutboundPreDeductLine = {
  type: string
  label: string
  amount: number
  detail?: string
}

export type ErpOutboundPreDeduct = {
  destRegion?: string
  priceTemplateId?: string
  priceTemplateName?: string
  preDeductTotal: number
  totalVolumeM3?: number
  totalWeightKg?: number
  lines: ErpOutboundPreDeductLine[]
  deductedAt?: string
  templateSnapshot?: {
    handling: { perOrderBase: number; perUnit: number; perSkuLine: number }
    shipping: { mode: 'volume' | 'weight'; ratePerCbm?: number; ratePerKg?: number; minCharge: number }
    pickup?: { perOrder: number; perUnit: number; minCharge: number }
    shippingMethod: string
    destRegion: string
  }
}

export type ErpOutboundMeasure = {
  cartons: { cartonNo: number; lengthCm: number; widthCm: number; heightCm: number; grossWeightKg: number; volumeCbm: number }[]
  totalVolumeM3: number
  totalWeightKg: number
  measuredAt: string
}

export type ErpOutboundActualFees = {
  lines: { type: string; label: string; amount: number; detail?: string; chargeType?: string }[]
  actualTotal: number
  calculatedAt: string
}

export type ErpOutboundOrder = {
  id: number
  outboundNo: string
  warehouseCode?: string
  platform?: string | null
  status: string
  omsStatus: string
  fbaNo?: string | null
  fbaWarehouse?: string | null
  destination?: string | null
  shippingMethod?: string | null
  source?: string | null
  orderNo?: string | null
  destRegion?: string | null
  preDeduct?: ErpOutboundPreDeduct | null
  measure?: ErpOutboundMeasure | null
  actualFees?: ErpOutboundActualFees | null
  recipient?: OutboundRecipient | null
  stockSource?: 'catalog' | 'owned'
  sellerStoreName?: string | null
  takealotSellerId?: string | null
  takealotBookingRef?: string | null
  shipmentDueDate?: string | null
  appointmentDate?: string | null
  trackingNo: string | null
  carrier: string | null
  remark?: string | null
  items: { sku: string; productName: string | null; qty: number }[]
  idempotent?: boolean
}

export type ErpLogisticsItem = {
  id: string
  refNo: string
  outboundNo: string
  carrier: string
  trackingNo: string
  status: 'in_transit' | 'delivered' | 'exception'
  destination: string
  updatedAt: string
  podStatus: 'pending' | 'uploaded' | 'not_required'
  podCode?: string | null
  podFileName?: string | null
  podUploadedAt?: string | null
}

export type ErpInventoryViewItem = ErpSkuHolding & {
  warehouseCode: string
  warehouseAvailable: number
  warehouseLocked: number
  warehouseTotal: number
  stockSource: 'catalog'
}

export function createErpInbound(body: {
  inboundNo?: string
  customerCode?: string
  customerId?: string
  warehouseCode?: string
  trackingNo?: string
  remark?: string
  source?: string
  inboundType?: string
  deliveryMethod?: string
  stockSource?: string
  referenceNo?: string
  eta?: string
  contact?: string
  contactPhone?: string
  attachments?: { fileType?: string; fileName: string; contentBase64?: string; url?: string }[]
  items: { sku: string; qty: number; productName?: string; boxNo?: number }[]
}) {
  return apiPost<ErpInboundOrder>('/erp/inbound', body)
}

export function syncErpInbounds(customerCode: string) {
  return apiGet<{ items: ErpInboundOrder[]; total: number }>(
    `/erp/inbound/by-customer/${encodeURIComponent(customerCode)}`,
  )
}

export type ErpReturnOrder = {
  id: number
  returnNo: string
  customerCode: string
  orderNo: string
  referenceNo: string
  trackingNo: string
  sellerStoreName: string
  sellerTaxNo: string
  returnWarehouse: string
  expectedArrivalAt: string | null
  returnReason: string
  returnDescription: string
  requestedProcess: string
  requestedProcessLabel: string
  status: string
  statusLabel: string
  processResult: string
  processResultLabel: string
  processRemark: string
  receivedAt: string | null
  processedAt: string | null
  createdAt: string
  updatedAt: string
  items: { sku: string; productName: string; quantity: number }[]
  totalQty: number
  idempotent?: boolean
  attachments?: { id?: number; fileType: string; fileName: string; createdAt?: string }[]
  inspectionPhotos?: { id?: number; fileType: string; fileName: string; createdAt?: string }[]
  totalVolumeCbm?: number | null
  estimatedFeeTotal?: number | null
  feeStatus?: string
  inspectionResult?: string
  inspectionResultLabel?: string
  inspectionRemark?: string
  inspectedAt?: string | null
  customerDecision?: string
  customerDecisionLabel?: string
  customerDecidedAt?: string | null
  customerProcessChoice?: string
  customerProcessChoiceLabel?: string
  decisionDeadline?: string | null
}

export function createErpReturn(body: {
  returnNo?: string
  customerCode?: string
  customerId?: string
  orderNo: string
  referenceNo?: string
  trackingNo?: string
  sellerStoreName?: string
  sellerTaxNo?: string
  returnWarehouse?: string
  expectedArrivalAt?: string
  returnReason: string
  returnDescription?: string
  requestedProcess: string
  remark?: string
  attachments?: { fileType?: string; fileName: string; contentBase64?: string; url?: string }[]
  items: { sku: string; quantity: number; productName?: string }[]
}) {
  return apiPost<ErpReturnOrder>('/erp/returns', body)
}

export function syncErpReturns(customerCode: string) {
  return apiGet<{ items: ErpReturnOrder[]; total: number }>(
    `/erp/returns/by-customer/${encodeURIComponent(customerCode)}`,
  )
}

export function cancelErpReturn(returnNo: string, customerCode: string) {
  return apiPost<ErpReturnOrder>(`/erp/returns/${encodeURIComponent(returnNo)}/cancel`, { customerCode })
}

export function decideErpReturn(
  returnNo: string,
  body: { customerCode: string; decision: 'keep' | 'discard'; processChoice?: string },
) {
  return apiPost<ErpReturnOrder>(`/erp/returns/${encodeURIComponent(returnNo)}/decide`, body)
}

export function createErpOutbound(body: {
  outboundNo?: string
  customerCode?: string
  customerId?: string
  warehouseCode?: string
  platform?: string
  fbaNo?: string
  appointmentDate?: string
  shipmentDueDate?: string
  sellerStoreName?: string
  takealotSellerId?: string
  takealotBookingRef?: string
  shippingMethod?: string
  destination?: string
  source?: string
  orderNo?: string
  recipient?: OutboundRecipient
  remark?: string
  stockSource?: 'catalog' | 'owned'
  destType?: string
  fbaWarehouse?: string
  items: { sku: string; qty: number; productName?: string }[]
  attachments?: { fileType?: string; fileName: string; contentBase64?: string; url?: string }[]
  preDeduct?: ErpOutboundPreDeduct
}) {
  return apiPost<ErpOutboundOrder>('/erp/outbound', body)
}

export function syncErpOutbounds(customerCode: string) {
  return apiGet<{ items: ErpOutboundOrder[]; total: number }>(
    `/erp/outbound/by-customer/${encodeURIComponent(customerCode)}`,
  )
}

export type ErpSkuOutboundLog = {
  outboundNo: string
  outboundId: number
  sku: string
  qty: number
  status: string
  omsStatus: string
  statusLabel: string
  refNo?: string | null
  fbaNo?: string | null
  fbaWarehouse?: string | null
  warehouseCode: string
  destination?: string
  platform?: string | null
  trackingNo?: string | null
  appointmentDate?: string | null
  createdAt: string
  shippedAt?: string | null
  deliveredAt?: string | null
}

export function fetchSkuOutboundLogs(customerCode: string, sku: string) {
  return apiGet<{ items: ErpSkuOutboundLog[]; total: number }>(
    `/erp/outbound/by-customer/${encodeURIComponent(customerCode)}/sku/${encodeURIComponent(sku)}/outbounds`,
  )
}

export function syncErpLogistics(customerCode: string) {
  return apiGet<{ items: ErpLogisticsItem[]; total: number }>(
    `/erp/logistics/by-customer/${encodeURIComponent(customerCode)}`,
  )
}

export function uploadPodToErp(
  outboundNo: string,
  body: { customerCode: string; fileName: string; contentBase64: string },
) {
  return apiPost<ErpOutboundOrder>(`/erp/outbound/${encodeURIComponent(outboundNo)}/pod`, body)
}

/** OMS 代理：下载/预览 ERP 上的 POD 签收单 */
export function getOutboundPodFileUrl(outboundNo: string, inline = false) {
  const q = inline ? '?inline=1' : ''
  return `/api/erp/outbound/${encodeURIComponent(outboundNo)}/pod${q}`
}

export function syncErpInventoryView(customerCode: string) {
  return apiGet<{
    customerCode: string
    customerName: string
    warehouseCode: string
    items: ErpInventoryViewItem[]
    total: number
  }>(`/erp/customers/${encodeURIComponent(customerCode)}/inventory-view`)
}

/** ─── P2 ─── */

export type ErpChargeItem = {
  id: number
  chargeNo: string
  customerCode: string | null
  chargeType: string
  chargeTypeLabel: string
  description: string | null
  amount: number
  chargeDate: string
  bizRef: string | null
  status: string
}

export type ErpRechargeItem = {
  id: number
  rechargeNo: string
  amount: number
  paymentMethod: string
  status: string
  remark: string | null
  createdAt: string
}

export type ErpAnnouncementItem = {
  id: number
  title: string
  category: string
  content: string
  date: string
  type: string
  isPinned: boolean
}

export function getErpCharges(customerCode: string) {
  return apiGet<{
    customerCode: string
    balance: number
    items: ErpChargeItem[]
    total: number
  }>(`/erp/customers/${encodeURIComponent(customerCode)}/charges`)
}

export type ErpBillItem = {
  id: number
  billingNo: string
  customerId: number
  customerName: string
  billingMonth: string
  totalAmount: number
  paidAmount: number
  status: string
  remark?: string | null
  createdAt?: string
}

export function getErpBills(customerCode: string) {
  return apiGet<{ customerCode: string; items: ErpBillItem[]; total: number }>(
    `/erp/customers/${encodeURIComponent(customerCode)}/bills`,
  )
}

export function getErpRecharges(customerCode: string) {
  return apiGet<{
    customerCode: string
    balance: number
    items: ErpRechargeItem[]
    total: number
  }>(`/erp/customers/${encodeURIComponent(customerCode)}/recharges`)
}

export function createErpRecharge(
  customerCode: string,
  body: {
    amount: number
    paymentMethod?: string
    paymentMethodId?: string
    paymentMethodTitle?: string
    remark?: string
  },
) {
  return apiPost<{
    record: ErpRechargeItem
    balance: number
    customerCode: string
  }>(`/erp/customers/${encodeURIComponent(customerCode)}/recharge`, body)
}

export function getErpAnnouncements() {
  return apiGet<{ items: ErpAnnouncementItem[]; total: number }>('/erp/announcements')
}

export function createErpProduct(body: {
  sku: string
  customerSku?: string
  productName: string
  customerCode?: string
  customerId?: string
  spec?: string
  category?: string
  brand?: string
  barcode?: string
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  weightKg?: number
  costRmb?: number
  declaredValue?: number
  declaredNameEn?: string
  declaredNameCn?: string
  unit?: string
  remark?: string
}) {
  return apiPost<{ id: number; sku: string; productName: string; status: string }>('/erp/products', body)
}
