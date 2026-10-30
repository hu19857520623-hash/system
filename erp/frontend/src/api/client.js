/**
 * API Client - 统一后端接口封装
 * 文档：backend/docs/API.md
 */
import { clearAccessToken, getAccessToken } from '@/auth/tokenStore'
import { sessionReturnPath } from '@/auth/internalRedirect'
import { notifyPermissionFailure } from '@/auth/permissionEvents'
import { sessionRecoveryTarget } from '@/auth/sessionRecoveryTarget'
import { userFacingError } from '@erp/shared/user-facing-error'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export const flowDebugApi = {
  catalog: () => api.get('/flow-debug/catalog'),
  trace: (params) => api.get('/flow-debug/trace', params),
}

function describeNetworkError(err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (
    err instanceof TypeError
    || /failed to fetch|fetch failed|networkerror|econnrefused|econnreset/i.test(msg)
  ) {
    return new Error('暂时无法连接服务，请检查网络后重试；如持续失败，请联系管理员。')
  }
  return new Error(userFacingError(msg))
}

function shouldClearErpSession(url, status) {
  const path = String(url).split('?')[0]
  return status === 401
    && !/^\/auth\/login(?:\/|$)/.test(path)
    && !/^\/store-monitor(?:\/|$)/.test(path)
}

function responseFailure(url, status, payload, requestToken) {
  const sessionFailure = shouldClearErpSession(url, status)
  const changed = requestToken !== getAccessToken()
  notifyPermissionFailure(url, status, !changed)
  const message = sessionFailure && changed ? '原登录请求已失效，请使用当前账号继续' : userFacingError(payload, status)
  if (sessionFailure && !changed) {
    const target = sessionRecoveryTarget(requestToken) || sessionReturnPath(window.location)
    clearAccessToken()
    if (!/^\/login(?:\/|$)/i.test(window.location.pathname)) window.location.href = `/login?reason=session-expired&redirect=${encodeURIComponent(target)}`
  }
  const failure = new Error(message)
  failure.status = status
  return failure
}

async function downloadRequest(url) {
  const token = getAccessToken()
  let response
  try {
    response = await fetch(`${BASE_URL}${url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch (err) {
    throw describeNetworkError(err)
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw responseFailure(url, response.status, error, token)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)
  const fileName = match ? decodeURIComponent(match[1]) : 'download'
  return { blob, fileName }
}

export function triggerBrowserDownload(blob, fileName = 'download') {
  if (!blob || blob.size <= 0) throw new Error('文件内容为空')
  const url = URL.createObjectURL(blob)
  const safeName = fileName || 'download'
  const cleanup = () => window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  cleanup()
  return 'download'
}

async function openHtmlPrint(url) {
  const token = getAccessToken()
  let response
  try {
    response = await fetch(`${BASE_URL}${url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch (err) {
    throw describeNetworkError(err)
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw responseFailure(url, response.status, error, token)
  }
  const html = await response.text()
  const win = window.open('', '_blank')
  if (!win) throw new Error('无法打开打印窗口，请允许弹窗')
  win.document.write(html)
  win.document.close()
}

async function request(url, options = {}) {
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  }

  const token = getAccessToken()
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(`${BASE_URL}${url}`, config)
  } catch (err) {
    throw describeNetworkError(err)
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw responseFailure(url, response.status, error, token)
  }

  let json
  try { json = await response.json() } catch (err) { throw new Error(userFacingError(err)) }

  if (json && typeof json === 'object' && 'code' in json) {
    if (json.code !== 0) {
      throw responseFailure(url, Number(json.code), json.message, token)
    }
    return json.data
  }

  return json
}

export const api = {
  get: (url, params) => {
    const query = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')),
        ).toString()
      : ''
    return request(`${url}${query}`)
  },
  post: (url, data) => request(url, { method: 'POST', body: JSON.stringify(data) }),
  put: (url, data) => request(url, { method: 'PUT', body: JSON.stringify(data) }),
  patch: (url, data) => request(url, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (url, data) => request(url, { method: 'DELETE', ...(data === undefined ? {} : { body: JSON.stringify(data) }) }),
}

// ── 鉴权 ──

export const authApi = {
  login: (data) => api.post('/auth/login', data),
  health: () => api.get('/auth/health'),
  profile: () => api.get('/auth/profile'),
  updateProfile: (data) => api.put('/auth/profile', data),
  changePassword: (data) => api.put('/auth/password', data),
}

// ── 工作台 ──

export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  trends: (days = 7) => api.get('/dashboard/trends', { days }),
  announcements: () => api.get('/dashboard/announcements'),
  notifications: () => api.get('/dashboard/notifications'),
}

export const storeMonitorApi = {
  session: () => api.get('/store-monitor/session'),
  listStores: () => api.get('/store-monitor/stores'),
  checkStore: (slot) => api.get(`/store-monitor/stores/${slot}/check`),
  updateStore: (slot, data) => api.put(`/store-monitor/stores/${slot}`, data),
  diag: () => api.get('/store-monitor/diag'),
  browserBootstrap: () => api.post('/store-monitor/browser-bootstrap'),
}

// ── 用户 / 权限 ──

export const usersApi = {
  list: (params) => api.get('/users', params),
  detail: (id) => api.get(`/users/${id}`),
  roles: () => api.get('/users/roles'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  remove: (id) => api.delete(`/users/${id}`),
  getPermissions: (id) => api.get(`/users/${id}/permissions`),
  setPermissions: (id, permissions) => api.put(`/users/${id}/permissions`, { permissions }),
}

export const permissionsApi = {
  catalog: () => api.get('/permissions/catalog'),
}

// ── 线索 ──

export const leadApi = {
  list: (params) => api.get('/leads', params),
  exportCsv: (params) => {
    const query = new URLSearchParams(params || {}).toString()
    return downloadRequest(`/leads/export${query ? `?${query}` : ''}`)
  },
  assignees: () => api.get('/leads/assignees'),
  followSales: () => api.get('/leads/follow-sales'),
  detail: (id) => api.get(`/leads/${id}`),
  create: (data) => api.post('/leads', data),
  update: (id, data) => api.put(`/leads/${id}`, data),
  correct: (id, data) => api.post(`/leads/${id}/correct`, data),
  qrImage: (id) => downloadRequest(`/leads/${id}/qr-image`),
  remove: (id) => api.delete(`/leads/${id}`),
  followUp: (id, data) => api.post(`/leads/${id}/follow-up`, data),
  recall: (id) => api.post(`/leads/${id}/recall`),
  deal: (id, data) => api.post(`/leads/${id}/deal`, data),
  confirmToErp: (id, data) => api.post(`/leads/${id}/to-erp`, data),
  uploadDealAttachments: (id, dealId, attachments) =>
    api.post(`/leads/${id}/deals/${dealId}/attachments`, { attachments }),
  downloadDealAttachment: (id, dealId, attachmentId) =>
    downloadRequest(`/leads/${id}/deals/${dealId}/attachments/${attachmentId}`),
  report: (params) => api.get('/leads/report', params),
  importCsv: (content) => api.post('/leads/import', { content }),
}

// ── 商品 ──

export const productApi = {
  list: (params) => api.get('/products', params),
  detail: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products', data),
  importCsv: (content) => api.post('/products/import', { content }),
  update: (id, data) => api.put(`/products/${id}`, data),
  uploadImage: (id, data) => api.post(`/products/${id}/image`, data),
  deleteImage: (id, imageId) => api.delete(`/products/${id}/images/${imageId}`),
  disable: (id) => api.post(`/products/${id}/disable`),
  enable: (id) => api.post(`/products/${id}/enable`),
  confirmMaster: (id) => api.post(`/products/${id}/confirm-master`),
  remove: (id) => api.delete(`/products/${id}`),
  downloadSkuLabel: (sku) => downloadRequest(`/products/by-sku/${encodeURIComponent(sku)}/label`),
}

// ── 选品开发 ──

export const productDevApi = {
  list: (params) => api.get('/product-dev', params),
  detail: (id) => api.get(`/product-dev/${id}`),
  create: (data) => api.post('/product-dev', data),
  update: (id, data) => api.put(`/product-dev/${id}`, data),
  uploadPriceImage: (data) => api.post('/product-dev/price-image', data),
  submit: (id) => api.post(`/product-dev/${id}/submit`),
  approve: (id, data) => api.post(`/product-dev/${id}/approve`, data),
  reject: (id, data) => api.post(`/product-dev/${id}/reject`, data),
  remove: (id) => api.delete(`/product-dev/${id}`),
}

// ── 供应商 ──

export const supplierApi = {
  list: (params) => api.get('/suppliers', params),
  detail: (id) => api.get(`/suppliers/${id}`),
  create: (data) => api.post('/suppliers', data),
  importCsv: (content) => api.post('/suppliers/import', { content }),
  update: (id, data) => api.put(`/suppliers/${id}`, data),
  remove: (id) => api.delete(`/suppliers/${id}`),
}

// ── 采购 ──

export const purchaseApi = {
  list: (params) => api.get('/purchase-orders', params),
  listPrePoPendingAssign: (params) => api.get('/purchase-orders/pre-purchase/pending-assign', params),
  listMyPrePo: (params) => api.get('/purchase-orders/pre-purchase/my', params),
  exportPrePoInfo: (ids) => api.post('/purchase-orders/pre-purchase/export-info', { ids }),
  importPrePoInfo: (content) => api.post('/purchase-orders/pre-purchase/import-info', { content }),
  prePoDetail: (id) => api.get(`/purchase-orders/pre-purchase/${id}`),
  updatePrePo: (id, data) => api.put(`/purchase-orders/pre-purchase/${id}`, data),
  assignPrePo: (id, data) => api.post(`/purchase-orders/pre-purchase/${id}/assign`, data),
  cancelPrePo: (id, data) => api.post(`/purchase-orders/pre-purchase/${id}/cancel`, data),
  confirmPrePo: (id) => api.post(`/purchase-orders/pre-purchase/${id}/confirm`),
  setActualQty: (id, data) => api.post(`/purchase-orders/${id}/set-actual-qty`, data),
  listPendingSkus: (params) => api.get('/purchase-orders/pending-skus', params),
  listPendingMasterData: (params) => api.get('/purchase-orders/pending-master-data', params),
  listPendingSkuAssign: (params) => api.get('/purchase-orders/pending-sku-assign', params),
  assignPurchaser: (devId, data) => api.post(`/purchase-orders/assign-purchaser/${devId}`, data),
  listPurchasers: () => api.get('/purchase-orders/purchasers'),
  detail: (id) => api.get(`/purchase-orders/${id}`),
  create: (data) => api.post('/purchase-orders', data),
  importCsv: (content) => api.post('/purchase-orders/import', { content }),
  resubmit: (id, data) => api.post(`/purchase-orders/${id}/resubmit`, data),
  approve: (id, data) => api.post(`/purchase-orders/${id}/approve`, data || {}),
  reopenAudit: (id, data) => api.post(`/purchase-orders/${id}/reopen-audit`, data || {}),
  revisePending: (id, data) => api.put(`/purchase-orders/${id}/pending-audit`, data),
  updatePackageDimensions: (id, data) => api.put(`/purchase-orders/${id}/package-dimensions`, data),
  rejectPoAudit: (id, data) => api.post(`/purchase-orders/${id}/reject-po-audit`, data),
  markPaid: (id, data) => api.post(`/purchase-orders/${id}/mark-paid`, data || {}),
  markUnpaid: (id, data) => api.post(`/purchase-orders/${id}/mark-unpaid`, data || {}),
  voidOrder: (id) => api.post(`/purchase-orders/${id}/void`),
  remove: (id) => api.delete(`/purchase-orders/${id}`),
  removePrePo: (id) => api.delete(`/purchase-orders/pre-purchase/${id}`),
}

// ── 入库 ──

export const inboundApi = {
  list: (params) => api.get('/inbound', params),
  detail: (id) => api.get(`/inbound/${id}`),
  create: (data) => api.post('/inbound', data),
  confirm: (id, data) => api.post(`/inbound/${id}/confirm`, data),
  arrivalScan: (data) => api.post('/inbound/arrival-scan', data),
  listArrivalScans: (params) => api.get('/inbound/arrival-scans', params),
  startReceive: (id) => api.post(`/inbound/${id}/start-receive`),
  receiveBox: (id, data) => api.post(`/inbound/${id}/receive-box`, data),
  recordReceivedCartonCount: (id, data) => api.post(`/inbound/${id}/received-carton-count`, data),
  scanQc: (id, data) => api.post(`/inbound/${id}/scan-qc`, data),
  scanReceiptLabel: (id, data) => api.post(`/inbound/${id}/scan-receipt-label`, data),
  qc: (id, data) => api.post(`/inbound/${id}/qc`, data),
  qcAndMeasure: (id, data) => api.post(`/inbound/${id}/qc-and-measure`, data),
  reopenCount: (id, data) => api.post(`/inbound/${id}/reopen-count`, data),
  closeZero: (id, data) => api.post(`/inbound/${id}/close-zero`, data),
  resolveException: (id, data) => api.post(`/inbound/${id}/resolve-exception`, data),
  reduceQc: (id, data) => api.post(`/inbound/${id}/reduce-qc`, data),
  reduceCarton: (id, data) => api.post(`/inbound/${id}/reduce-carton`, data),
  reducePutaway: (id, data) => api.post(`/inbound/${id}/reduce-putaway`, data),
  measureDimensions: (id, data) => api.post(`/inbound/${id}/measure-dimensions`, data),
  putaway: (id, data) => api.post(`/inbound/${id}/putaway`, data),
  listDrafts: () => api.get('/inbound/drafts'),
  saveDraft: (data) => api.post('/inbound/drafts', data),
  deleteDraft: (draftNo) => api.delete(`/inbound/drafts/${encodeURIComponent(draftNo)}`),
  uploadAttachment: (data) => api.post('/inbound/attachments', data),
  downloadSkuLabel: (id, sku) => downloadRequest(`/inbound/${id}/labels/sku${sku ? `?sku=${encodeURIComponent(sku)}` : ''}`),
  downloadOuterLabel: (id) => downloadRequest(`/inbound/${id}/labels/outer`),
  downloadReceivingList: (id) => openHtmlPrint(`/inbound/${id}/receiving-list`),
  downloadOmsAttachment: (inboundId, attachmentId) =>
    downloadRequest(`/inbound/${inboundId}/attachments/${attachmentId}`),
  applySeaFreight: (id, data) => api.post(`/inbound/${id}/sea-freight`, data),
  clearSeaFreight: (id, data) => api.delete(`/inbound/${id}/sea-freight`, data),
  remove: (id) => api.delete(`/inbound/${id}`),
}

// ── 退件 ──

export const returnsApi = {
  list: (params) => api.get('/returns', params),
  detail: (id) => api.get(`/returns/${id}`),
  listFeeTemplates: () => api.get('/returns/fee-templates'),
  getActiveFeeTemplate: (params) => api.get('/returns/fee-templates/active', params),
  createFeeTemplate: (data) => api.post('/returns/fee-templates', data),
  updateFeeTemplate: (id, data) => api.put(`/returns/fee-templates/${id}`, data),
  deleteFeeTemplate: (id) => api.delete(`/returns/fee-templates/${id}`),
  receive: (id, data) => api.post(`/returns/${id}/receive`, data),
  reReceive: (id, data) => api.post(`/returns/${id}/re-receive`, data),
  measure: (id, data) => api.post(`/returns/${id}/measure`, data),
  previewFees: (id, data) => api.post(`/returns/${id}/fee-preview`, data),
  calculateFees: (id, data) => api.post(`/returns/${id}/calculate-fees`, data || {}),
  submitInspection: (id, data) => api.post(`/returns/${id}/inspect`, data),
  dispose: (id, data) => api.post(`/returns/${id}/dispose`, data),
  process: (id, data) => api.post(`/returns/${id}/process`, data),
  downloadAttachment: (id, attachmentId) => downloadRequest(`/returns/${id}/attachment/${attachmentId}`),
}

// ── 库存 ──

export const inventoryApi = {
  query: (params) => api.get('/inventory', params),
  skuQuery: (params) => api.get('/inventory/sku-query', params),
  updateSkuCatalog: (id, data) => api.patch(`/inventory/sku-query/${id}`, data),
  byLocation: (params) => api.get('/inventory/by-location', params),
  addLocationStock: (data) => api.post('/inventory/by-location', data),
  changeLocationStock: (data) => api.post('/inventory/location-change', data),
  batchChangeLocationStock: (data) => api.post('/inventory/location-change/batch', data),
  adjustLocation: (id, data) => api.patch(`/inventory/by-location/${id}`, data),
  logs: (sku, params) => api.get(`/inventory/logs/${encodeURIComponent(sku)}`, params),
  outboundLogs: (sku, params) => api.get(`/inventory/logs/${encodeURIComponent(sku)}/outbound`, params),
  catalogPurchases: (params) => api.get('/inventory/catalog-purchases', params),
  previewCatalogReclaim: (data) => api.post('/inventory/catalog-reclaim/preview', data),
  catalogReclaimHistory: (params) => api.get('/inventory/catalog-reclaims', params),
  retryCatalogReclaimSync: (id) => api.post(`/inventory/catalog-reclaims/${id}/retry-sync`),
  reclaimCatalogHolding: (data) => api.post('/inventory/catalog-reclaim', data),
  transferLogistics: (data) => api.post('/inventory/logistics-transfer', data),
}

// ── 出库 ──

export const outboundApi = {
  list: (params) => api.get('/outbound', params),
  statusCounts: (params) => api.get('/outbound/status-counts', params),
  detail: (id) => api.get(`/outbound/${id}`),
  create: (data) => api.post('/outbound', data),
  uploadAttachment: (id, data) => api.post(`/outbound/${id}/attachment`, data),
  downloadAttachment: (id) => downloadRequest(`/outbound/${id}/attachment`),
  downloadAttachmentById: (id, attachmentId) => downloadRequest(`/outbound/${id}/attachment/${attachmentId}`),
  downloadPod: (id) => downloadRequest(`/outbound/${id}/pod`),
  downloadSkuLabels: (id) => downloadRequest(`/outbound/${id}/labels`),
  downloadSkuLabelsBySku: (id, sku) =>
    downloadRequest(`/outbound/${id}/labels/sku/${encodeURIComponent(sku)}`),
  downloadSkuLabelUnit: (id, sku, unitIndex) =>
    downloadRequest(`/outbound/${id}/labels/sku/${encodeURIComponent(sku)}/unit/${encodeURIComponent(unitIndex)}`),
  confirmRelabel: (id, data) => api.post(`/outbound/${id}/confirm-relabel`, data || {}),
  pick: (id, data) => api.post(`/outbound/${id}/pick`, data),
  pickSuggestions: (id) => api.get(`/outbound/${id}/pick-suggestions`),
  startReview: (id) => api.post(`/outbound/${id}/start-review`, {}),
  downloadPickList: (id) => openHtmlPrint(`/outbound/${id}/pick-list`),
  pack: (id, data) => api.post(`/outbound/${id}/pack`, data || {}),
  deliver: (id, data) => api.post(`/outbound/${id}/deliver`, data || {}),
  ship: (id, data) => api.post(`/outbound/${id}/ship`, data || {}),
  syncShipment: (id) => api.post(`/outbound/${id}/sync-shipment`, {}),
  cancel: (id) => api.post(`/outbound/${id}/cancel`),
  assignPicker: (data) => api.post('/outbound/assign-picker', data),
  setProblem: (id, data) => api.post(`/outbound/${id}/problem`, data),
  exportCsv: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString()
    return downloadRequest(`/outbound/export${qs ? `?${qs}` : ''}`)
  },
}

// ── 仓库 ──

export const warehouseApi = {
  list: (params) => api.get('/warehouses', params),
  detail: (id) => api.get(`/warehouses/${id}`),
  create: (data) => api.post('/warehouses', data),
  update: (id, data) => api.patch(`/warehouses/${id}`, data),
  updateCapacity: (id, data) => api.patch(`/warehouses/${id}/capacity`, data),
}

export const takealotDestApi = {
  list: (params) => api.get('/takealot-dest-warehouses', params),
  create: (data) => api.post('/takealot-dest-warehouses', data),
  update: (id, data) => api.patch(`/takealot-dest-warehouses/${id}`, data),
}

export const warehouseZoneApi = {
  list: (params) => api.get('/warehouse-zones', params),
  create: (data) => api.post('/warehouse-zones', data),
  update: (id, data) => api.put(`/warehouse-zones/${id}`, data),
  partitionLetters: (warehouseCode) => api.get('/warehouse-zones/partition-letters', { warehouseCode }),
}

export const locationApi = {
  list: (params) => api.get('/locations', params),
  create: (data) => api.post('/locations', data),
  batchCreate: (data) => api.post('/locations/batch', data),
  update: (id, data) => api.put(`/locations/${id}`, data),
  inventory: (id) => api.get(`/locations/${id}/inventory`),
  printLabel: (id) => openHtmlPrint(`/locations/${id}/label`),
  printLabels: (params) => {
    const qs = new URLSearchParams(
      Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString()
    return openHtmlPrint(`/locations/labels/print${qs ? `?${qs}` : ''}`)
  },
}

export const logisticsReceiptApi = {
  listPendingPos: (params) => api.get('/logistics-receipts/pending-pos', params),
  list: (params) => api.get('/logistics-receipts', params),
  create: (data) => api.post('/logistics-receipts', data),
}

// ── 定价 ──

export const pricingApi = {
  setVisibleStock: (id, data) => api.post(`/pricing/${id}/visible-stock`, data),
  list: (params) => api.get('/pricing', params),
  detail: (id) => api.get(`/pricing/${id}`),
  create: (data) => api.post('/pricing', data),
  update: (id, data) => api.put(`/pricing/${id}`, data),
  confirm: (id, data) => api.post(`/pricing/${id}/confirm`, data),
  syncOms: (id) => api.post(`/pricing/${id}/sync-oms`),
  setShareStatus: (id, status) => api.post(`/pricing/${id}/share-status`, { status }),
  repriceRequest: (id, requestId) => api.get(`/pricing/${id}/reprice-requests/${requestId}`),
  cancelRepriceRequest: (id, requestId) => api.post(`/pricing/${id}/reprice-requests/${requestId}/cancel`, {}),
  reprice: (id, data) => api.post(`/pricing/${id}/reprice`, data),
  omsPurchase: (data) => api.post('/pricing/oms/purchase', data),
  omsCatalog: (params) => api.get('/pricing/oms/catalog', params),
  omsCatalogSku: (sku) => api.get(`/pricing/oms/catalog/${encodeURIComponent(sku)}`),
}

// ── 成本 ──

export const costApi = {
  list: (params) => api.get('/cost-ledger', params),
  create: (data) => api.post('/cost-ledger', data),
}

// ── 同步日志 ──

export const syncApi = {
  list: (params) => api.get('/sync-logs', params),
  retry: (id) => api.post(`/sync-logs/${id}/retry`),
}

export const operationLogApi = {
  list: (params) => api.get('/operation-logs', params),
}

// ── 客户 ──

export const customerApi = {
  list: (params) => api.get('/customers', params),
  detail: (id) => api.get(`/customers/${id}`),
  create: (data) => api.post('/customers', data),
  update: (id, data) => api.put(`/customers/${id}`, data),
  resetPortalTemporaryPassword: (id, data) => api.post(`/customers/${id}/portal-password`, data),
  recharge: (id, data) => api.post(`/customers/${id}/recharge`, data),
  rechargeHistory: (id) => api.get(`/customers/${id}/recharges`),
  skuInventory: (id) => api.get(`/customers/${id}/sku-inventory`),
}

// ── 结算 ──

export const billingApi = {
  list: (params) => api.get('/billing', params),
  listCharges: (params) => api.get('/billing/charges', params),
  createCharge: (data) => api.post('/billing/charges', data),
  previewGenerate: (data) => api.post('/billing/generate/preview', data),
  generate: (data) => api.post('/billing/generate', data),
  detail: (id) => api.get(`/billing/${id}`),
  create: (data) => api.post('/billing', data),
  settlementPreview: (id) => api.get(`/billing/${id}/settlement-preview`),
  confirm: (id, data) => api.post(`/billing/${id}/confirm`, data),
}

// ── 海运账单 ──

export const freightBillApi = {
  list: (params) => api.get('/freight-bills', params),
  containerOptions: () => api.get('/freight-bills/container-options'),
  create: (data) => api.post('/freight-bills', data),
}

export const mingruiApi = {
  list: (params) => api.get('/mingrui-shipments', params),
  eligiblePos: () => api.get('/mingrui-shipments/eligible-pos'),
  detail: (id) => api.get(`/mingrui-shipments/${id}`),
  create: (data) => api.post('/mingrui-shipments', data),
  update: (id, data) => api.patch(`/mingrui-shipments/${id}`, data),
  submit: (id) => api.post(`/mingrui-shipments/${id}/submit`),
  sync: (id, data) => api.post(`/mingrui-shipments/${id}/sync`, data),
  cancel: (id) => api.post(`/mingrui-shipments/${id}/cancel`),
}

// ── 利润 ──

export const profitApi = {
  summary: (params) => api.get('/profit/summary', params),
  detail: (params) => api.get('/profit/detail', params),
}

export const managementLoopApi = {
  reportSummary: (params) => api.get('/management-loop/reports/summary', params),
  inboundReport: (params) => api.get('/management-loop/reports/inbound', params),
  outboundReport: (params) => api.get('/management-loop/reports/outbound', params),
  stocktakes: (params) => api.get('/management-loop/stocktakes', params),
  stocktake: (id) => api.get(`/management-loop/stocktakes/${id}`),
  stocktakeOptions: (params) => api.get('/management-loop/stocktake-options', params),
  createStocktake: (data) => api.post('/management-loop/stocktake-workflows', data),
  countStocktake: (id, data) => api.post(`/management-loop/stocktake-workflows/${id}/count`, data),
  approveStocktake: (id, data) => api.post(`/management-loop/stocktake-workflows/${id}/approve`, data),
  cancelStocktake: (id, data) => api.post(`/management-loop/stocktake-workflows/${id}/cancel`, data),
  replanStocktake: (id, data) => api.post(`/management-loop/stocktake-workflows/${id}/replan`, data),
  stocktakeRequest: (requestId) => api.get(`/management-loop/stocktake-requests/${encodeURIComponent(requestId)}`),
  capacity: (params) => api.get('/management-loop/capacity', params),
  refreshCapacityAlerts: (data) => api.post('/management-loop/capacity-workflows/refresh-alerts', data),
  capacityRequest: (requestId) => api.get(`/management-loop/capacity-requests/${encodeURIComponent(requestId)}`),
}

export const inboundFeeApi = {
  list: () => api.get('/inbound-fee-rules'),
  options: () => api.get('/inbound-fee-rules/options'),
  create: (data) => api.post('/inbound-fee-rules', data),
  update: (id, data) => api.patch(`/inbound-fee-rules/${id}`, data),
}

export const operatingLedgerApi = {
  list: (params) => api.get('/operating-ledger', params),
  create: (data) => api.post('/operating-ledger', data),
  importCsv: (data) => api.post('/operating-ledger/import', data),
  update: (id, data) => api.put(`/operating-ledger/${id}`, data),
  remove: (id) => api.delete(`/operating-ledger/${id}`),
}

// ── 公告 ──

export const announcementApi = {
  request: (id) => api.get(`/announcements/requests/${id}`),
  cancelRequest: (id) => api.post(`/announcements/requests/${id}/cancel`, {}),
  list: (params) => api.get('/announcements', params),
  detail: (id) => api.get(`/announcements/${id}`),
  create: (data) => api.post('/announcements', data),
  update: (id, data) => api.put(`/announcements/${id}`, data),
  remove: (id) => api.delete(`/announcements/${id}`),
}

// ── 异步 IO ──

export const asyncIoApi = {
  list: (params) => api.get('/async-io', params),
  create: (data) => api.post('/async-io', data),
  export: (data) => api.post('/async-io/export', data),
  import: (data) => api.post('/async-io/import', data),
  detail: (id) => api.get(`/async-io/${id}`),
  retry: (id, expectedAttempt) => api.post(`/async-io/${id}/retry`, { expectedAttempt }),
  restart: (id, expectedAttempt) => api.post(`/async-io/${id}/restart`, { expectedAttempt }),
  download: (id) => downloadRequest(`/async-io/${id}/download`),
}

export const anhengApi = {
  config: () => api.get('/anheng/config'),
  saveConfig: (data) => api.put('/anheng/config', data),
  events: (params) => api.get('/anheng/events', params),
  photos: (params) => api.get('/anheng/photos', params),
  photoFile: (id) => downloadRequest(`/anheng/photos/${id}/file`),
  simulateWeigh: (data) => api.post('/anheng/simulate/weigh', data),
  simulateImage: (data) => api.post('/anheng/simulate/image', data),
  clearEvents: () => api.delete('/anheng/events'),
}

export default api
