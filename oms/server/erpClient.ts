const ERP_API_BASE = (process.env.ERP_API_BASE || 'http://127.0.0.1:3000/api').replace(/\/$/, '')

export class ErpApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ErpApiError'
    this.status = status
    this.body = body
  }
}

type ErpEnvelope<T> = {
  code: number
  message: string
  data: T
}

async function erpRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${ERP_API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    throw new ErpApiError(502, `无法连接 ERP（${ERP_API_BASE}）：${err instanceof Error ? err.message : String(err)}`)
  }

  const text = await res.text().catch(() => '')
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
  }

  if (!res.ok) {
    const msg =
      typeof json === 'object' && json && 'message' in json
        ? String((json as { message: unknown }).message)
        : text || res.statusText
    throw new ErpApiError(res.status, msg || `ERP ${path} failed`, json)
  }

  if (json && typeof json === 'object' && 'code' in json && 'data' in json) {
    const envelope = json as ErpEnvelope<T>
    if (envelope.code !== 0) {
      throw new ErpApiError(400, envelope.message || 'ERP 业务错误', json)
    }
    return envelope.data
  }

  return json as T
}

function internalHeaders() {
  const token = String(process.env.OMS_INTERNAL_TOKEN || '').trim()
  if (!token) {
    throw new ErpApiError(503, 'OMS_INTERNAL_TOKEN is required for ERP internal requests')
  }
  if (process.env.NODE_ENV === 'production' && Buffer.byteLength(token, 'utf8') < 32) {
    throw new ErpApiError(503, 'OMS_INTERNAL_TOKEN must be at least 32 bytes in production')
  }
  return { 'x-oms-internal-token': token }
}

export type ErpOmsProvisionRequest = {
  customerCode?: string
  customerName: string
  companyName?: string
  contactEmail: string
  contactName?: string
  contactPhone?: string
  omsType: 'ecommerce' | 'catalog' | 'hybrid'
  warehouse: string
  permissions: string[]
  loginEmail: string
  temporaryPassword: string
}

export type ErpOmsProvisionResponse = {
  customer: {
    id: number | string
    customerCode: string
    customerName: string
    companyName?: string | null
    contactEmail?: string | null
    contactName?: string | null
    contactPhone?: string | null
    status?: number | string
  }
  portalAccount: {
    id: string
    customerId: string
    loginEmail: string
    role: 'ecommerce' | 'catalog' | 'hybrid'
    status: 'active' | 'disabled'
    mustChangePassword: boolean
  }
}

export function provisionOmsCustomer(body: ErpOmsProvisionRequest) {
  const path = String(
    process.env.ERP_OMS_PROVISION_PATH || '/customers/oms/provision',
  ).trim()
  return erpRequest<ErpOmsProvisionResponse>(path, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify(body),
  })
}

export type ErpOmsCustomerUpdateRequest = {
  customerName?: string
  companyName?: string
  contactEmail?: string
  contactName?: string
  contactPhone?: string
  status?: 0 | 1
  omsType?: 'ecommerce' | 'catalog' | 'hybrid'
  warehouse?: string
  permissions?: string[]
  permissionTemplate?: string
  loginEmail?: string
}

export function updateOmsCustomer(
  customerCode: string,
  body: ErpOmsCustomerUpdateRequest,
) {
  const template = String(
    process.env.ERP_OMS_UPDATE_PATH || '/customers/oms/by-code/:customerCode',
  ).trim()
  const path = template.replace(':customerCode', encodeURIComponent(customerCode))
  return erpRequest<unknown>(path, {
    method: 'PUT',
    headers: internalHeaders(),
    body: JSON.stringify(body),
  })
}

export function resetOmsPortalPassword(
  customerCode: string,
  body: { loginEmail: string; temporaryPassword: string },
) {
  const template = String(
    process.env.ERP_OMS_RESET_PASSWORD_PATH
      || '/customers/oms/by-code/:customerCode/portal-password',
  ).trim()
  const path = template.replace(':customerCode', encodeURIComponent(customerCode))
  return erpRequest<ErpOmsProvisionResponse['portalAccount']>(path, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify(body),
  })
}

export type ErpCatalogItem = {
  sku: string
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
  companyName: string | null
  contactEmail: string | null
  contactName: string | null
  contactPhone: string | null
  balance: number
  status: number
  statusLabel: string
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

export function getErpApiBase() {
  return ERP_API_BASE
}

export function fetchErpCatalog() {
  return erpRequest<{ items: ErpCatalogItem[]; total: number; syncedAt: string }>('/pricing/oms/catalog')
}

export function fetchErpCatalogSku(sku: string) {
  return erpRequest<ErpCatalogItem>(`/pricing/oms/catalog/${encodeURIComponent(sku)}`)
}

export function purchaseErpCatalog(body: {
  orderNo: string
  customerCode: string
  sku: string
  quantity: number
  unitPrice?: number
}) {
  return erpRequest<ErpPurchaseResult>('/pricing/oms/purchase', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchErpCustomerByCode(customerCode: string) {
  return erpRequest<ErpCustomer>(`/customers/oms/by-code/${encodeURIComponent(customerCode)}`)
}

export function fetchErpSkuInventoryByCode(customerCode: string) {
  return erpRequest<ErpSkuHolding[]>(
    `/customers/oms/by-code/${encodeURIComponent(customerCode)}/sku-inventory`,
  )
}

export type ErpInboundOrder = {
  id: number
  inboundNo: string
  warehouseCode: string
  trackingNo: string | null
  status: string
  displayStatus: string
  omsStatus: string
  omsCustomerCode: string | null
  remark: string | null
  source?: string | null
  inboundType?: string | null
  deliveryMethod?: string | null
  stockSource?: string | null
  referenceNo?: string | null
  eta?: string | null
  contact?: string | null
  contactPhone?: string | null
  totalExpectedQty: number
  totalReceivedQty: number
  createdAt: string
  updatedAt: string
  items: { sku: string; expectedQty: number; receivedQty: number; productId: number; productName?: string }[]
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
}

export type ErpOutboundRecipient = {
  name: string
  province?: string
  city: string
  postalCode: string
  phone: string
  address1: string
  address2?: string
  email?: string
}

export type ErpOutboundOrder = {
  id: number
  outboundNo: string
  customerId: number | null
  customerCode: string | null
  warehouseCode: string
  status: string
  omsStatus: string
  fbaNo: string | null
  fbaWarehouse: string | null
  destination?: string | null
  shippingMethod?: string | null
  source?: string | null
  orderNo?: string | null
  destRegion?: string | null
  preDeduct?: ErpOutboundPreDeduct | null
  measure?: {
    cartons: { cartonNo: number; lengthCm: number; widthCm: number; heightCm: number; grossWeightKg: number; volumeCbm: number }[]
    totalVolumeM3: number
    totalWeightKg: number
    measuredAt: string
  } | null
  actualFees?: {
    lines: { type: string; label: string; amount: number; detail?: string; chargeType?: string }[]
    actualTotal: number
    calculatedAt: string
  } | null
  recipient?: ErpOutboundRecipient | null
  stockSource?: 'catalog' | 'owned'
  sellerStoreName: string | null
  takealotSellerId: string | null
  takealotBookingRef: string | null
  shipmentDueDate: string | null
  trackingNo: string | null
  carrier: string | null
  platform: string | null
  remark: string | null
  appointmentDate: string | null
  shippedAt: string | null
  deliveredAt: string | null
  items: { sku: string; productName: string | null; qty: number; productId: number }[]
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
  exceptionReason?: string | null
}

export type ErpInventoryViewItem = ErpSkuHolding & {
  warehouseCode: string
  warehouseAvailable: number
  warehouseLocked: number
  warehouseTotal: number
  stockSource: 'catalog'
}

export function createErpInboundAsn(body: {
  inboundNo?: string
  customerCode: string
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
  items: { sku: string; qty: number; productName?: string; boxNo?: number }[]
  attachments?: { fileName: string; contentBase64: string; fileType?: string }[]
}) {
  return erpRequest<ErpInboundOrder>('/inbound/oms/asn', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchErpInboundsByCustomer(customerCode: string) {
  return erpRequest<{ items: ErpInboundOrder[]; total: number }>(
    `/inbound/oms/by-customer/${encodeURIComponent(customerCode)}`,
  )
}

export function fetchErpInboundByNo(inboundNo: string) {
  return erpRequest<ErpInboundOrder>(`/inbound/oms/by-no/${encodeURIComponent(inboundNo)}`)
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
  estimatedFeeTotal?: number | null
  totalVolumeCbm?: number | null
  inspectionResult?: string | null
  inspectionRemark?: string | null
  customerDecision?: string | null
  customerDecidedAt?: string | null
  customerProcessChoice?: string | null
}

export function createErpReturn(body: {
  returnNo?: string
  customerCode: string
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
  return erpRequest<ErpReturnOrder>('/returns/oms', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchErpReturnsByCustomer(customerCode: string) {
  return erpRequest<{ items: ErpReturnOrder[]; total: number }>(
    `/returns/oms/by-customer/${encodeURIComponent(customerCode)}`,
  )
}

export function fetchErpReturnByNo(returnNo: string) {
  return erpRequest<ErpReturnOrder>(`/returns/oms/by-no/${encodeURIComponent(returnNo)}`)
}

export function cancelErpReturn(returnNo: string, customerCode: string) {
  return erpRequest<ErpReturnOrder>(`/returns/oms/by-no/${encodeURIComponent(returnNo)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ customerCode }),
  })
}

export function decideErpReturn(
  returnNo: string,
  body: { customerCode: string; decision: 'keep' | 'discard'; processChoice?: string },
) {
  return erpRequest<ErpReturnOrder>(`/returns/oms/by-no/${encodeURIComponent(returnNo)}/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function downloadErpReturnAttachment(returnNo: string, attachmentId: number) {
  const url = `${ERP_API_BASE}/returns/oms/by-no/${encodeURIComponent(returnNo)}/attachment/${attachmentId}`
  const res = await fetch(url, { headers: { Accept: '*/*' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ErpApiError(res.status, text || res.statusText)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd)
  const fileName = decodeURIComponent(m?.[1] || m?.[2] || `attachment-${attachmentId}`)
  return { fileName, content: buf }
}

export function createErpOutbound(body: {
  outboundNo?: string
  customerCode: string
  warehouseCode?: string
  platform?: string
  fbaNo?: string
  poNumber?: string
  appointmentDate?: string
  shipmentDueDate?: string
  sellerStoreName?: string
  takealotSellerId?: string
  takealotBookingRef?: string
  remark?: string
  stockSource?: 'catalog' | 'owned'
  destType?: string
  fbaWarehouse?: string
  shippingMethod?: string
  destination?: string
  source?: string
  orderNo?: string
  recipient?: ErpOutboundRecipient
  items: { sku: string; qty: number; productName?: string }[]
  attachments?: {
    fileType?: string
    fileName: string
    contentBase64: string
    sku?: string
    platformBarcode?: string
    unitIndex?: number
    sourcePage?: number
    sourceRow?: number
    sourceColumn?: number
    labelRole?: string
    contentHash?: string
  }[]
  preDeduct?: ErpOutboundPreDeduct
}) {
  return erpRequest<ErpOutboundOrder>('/outbound/oms', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchErpOutboundsByCustomer(customerCode: string) {
  return erpRequest<{ items: ErpOutboundOrder[]; total: number }>(
    `/outbound/oms/by-customer/${encodeURIComponent(customerCode)}`,
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

export function fetchErpSkuOutbounds(customerCode: string, sku: string) {
  return erpRequest<{ items: ErpSkuOutboundLog[]; total: number }>(
    `/outbound/oms/by-customer/${encodeURIComponent(customerCode)}/sku/${encodeURIComponent(sku)}/outbounds`,
  )
}

export function fetchErpOutboundByNo(outboundNo: string) {
  return erpRequest<ErpOutboundOrder>(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`)
}

export function uploadErpPodReceipt(
  outboundNo: string,
  body: { customerCode: string; fileName: string; contentBase64: string },
) {
  return erpRequest<ErpOutboundOrder>(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}/pod`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function downloadErpOutboundPod(outboundNo: string, customerCode?: string) {
  const q = customerCode ? `?customerCode=${encodeURIComponent(customerCode)}` : ''
  const url = `${ERP_API_BASE}/outbound/oms/by-no/${encodeURIComponent(outboundNo)}/pod${q}`
  const res = await fetch(url, { headers: { Accept: '*/*' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ErpApiError(res.status, text || res.statusText)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd)
  const fileName = decodeURIComponent(m?.[1] || m?.[2] || `POD-${outboundNo}`)
  return { fileName, content: buf }
}

export function fetchErpLogisticsByCustomer(customerCode: string) {
  return erpRequest<{ items: ErpLogisticsItem[]; total: number }>(
    `/outbound/oms/by-customer/${encodeURIComponent(customerCode)}/logistics`,
  )
}

export function fetchErpInventoryView(customerCode: string, warehouseCode?: string) {
  const q = warehouseCode ? `?warehouseCode=${encodeURIComponent(warehouseCode)}` : ''
  return erpRequest<{
    customerCode: string
    customerName: string
    warehouseCode: string
    items: ErpInventoryViewItem[]
    total: number
  }>(`/customers/oms/by-code/${encodeURIComponent(customerCode)}/inventory-view${q}`)
}

/** ─── P2：费用 / 充值 / 公告 / 建品 ─── */

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
  publishedAt: string | null
}

export function fetchErpCharges(customerCode: string) {
  return erpRequest<{
    customerCode: string
    customerName: string
    balance: number
    items: ErpChargeItem[]
    total: number
  }>(`/billing/oms/by-customer/${encodeURIComponent(customerCode)}/charges`)
}

export function fetchErpBills(customerCode: string) {
  return erpRequest<{ customerCode: string; items: unknown[]; total: number }>(
    `/billing/oms/by-customer/${encodeURIComponent(customerCode)}/bills`,
  )
}

export function createErpRecharge(
  customerCode: string,
  body: {
    amount: number
    paymentMethod?: string
    paymentMethodTitle?: string
    remark?: string
    rechargeNo?: string
  },
) {
  return erpRequest<{
    record: ErpRechargeItem
    balance: number
    customerCode: string
    customerName: string
  }>(`/customers/oms/by-code/${encodeURIComponent(customerCode)}/recharge`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchErpRecharges(customerCode: string) {
  return erpRequest<{
    customerCode: string
    balance: number
    items: ErpRechargeItem[]
    total: number
  }>(`/customers/oms/by-code/${encodeURIComponent(customerCode)}/recharges`)
}

export function fetchErpAnnouncements() {
  return erpRequest<{ items: ErpAnnouncementItem[]; total: number }>('/announcements/oms')
}

export function createErpProduct(body: {
  sku: string
  productName: string
  customerCode?: string
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
  return erpRequest<{
    id: number
    sku: string
    productName: string
    status: string
    customerCode: string | null
    createdAt?: string
  }>('/products/oms', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
