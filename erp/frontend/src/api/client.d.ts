import type {
  OmsCustomerType,
  OmsPortalPermission,
} from '@erp/shared/oms-portal.permissions'

type ApiMethod = (...args: any[]) => Promise<any>
type ApiGroup = Record<string, ApiMethod>

export type { OmsCustomerType, OmsPortalPermission }

export interface CustomerCreateRequest {
  customerCode: string
  customerName: string
  companyName?: string
  contactEmail?: string
  contactName?: string
  contactPhone?: string
  status?: 0 | 1
  balance?: number
  portalType: OmsCustomerType
  /** Compatibility field used by the current ERP provisioning service. */
  omsType: OmsCustomerType
  warehouse: string
  permissionTemplate?: OmsCustomerType
  permissions?: OmsPortalPermission[]
  username: string
  temporaryPassword: string
}

export interface CustomerPortalAccountWire {
  omsId: string
  type: OmsCustomerType
  warehouse: string
  permissions: OmsPortalPermission[]
  omsStatus: 'active' | 'disabled'
  portalReady: boolean
  portalUsername?: string | null
  portalLoginEmail: string | null
  portalStatus: 'active' | 'disabled' | null
  mustChangePassword: boolean | null
  lastLoginAt?: string | null
  creditBalance?: number | null
  monthlySpent?: number | null
  pendingBill?: number | null
}

export interface PortalTemporaryPasswordRequest {
  username: string
  temporaryPassword: string
}

export interface PortalTemporaryPasswordResult {
  customerCode: string
  portalReady: true
  portalUsername?: string
  portalLoginEmail: string
  portalStatus: 'active' | 'disabled'
  mustChangePassword: true
}

export interface CustomerUpdateRequest {
  customerName?: string
  companyName?: string
  contactEmail?: string
  contactName?: string
  contactPhone?: string
  status?: 0 | 1
  balance?: number
  portalType?: OmsCustomerType
  omsType?: OmsCustomerType
  warehouse?: string
  permissionTemplate?: OmsCustomerType
  permissions?: OmsPortalPermission[]
  username?: string
  loginEmail?: string
}

export interface CustomerWire {
  id: number
  customerCode: string
  customerName: string
  companyName: string | null
  contactEmail: string | null
  contactName: string | null
  contactPhone: string | null
  balance: number
  status: 0 | 1
  createdAt: string
  updatedAt: string
  totalRecharge?: number
  lastRechargeAt?: string | null
  dataSource?: 'erp' | 'oms' | 'both'
  readOnly?: boolean
  oms?: CustomerPortalAccountWire | null
}

export interface CustomerListResponse {
  items: CustomerWire[]
  total: number
  page: number
  pageSize: number
}

export interface FileDownload {
  blob: Blob
  fileName: string
}

export function triggerBrowserDownload(
  blob: Blob,
  fileName?: string,
  options?: { preferNewTab?: boolean },
): 'tab' | 'download'

export interface OutboundApi extends ApiGroup {
  detail(id: number | string): Promise<any>
  downloadSkuLabels(id: number | string): Promise<FileDownload>
  downloadSkuLabelsBySku(id: number | string, sku: string): Promise<FileDownload>
  downloadSkuLabelUnit(
    id: number | string,
    sku: string,
    unitIndex: number,
  ): Promise<FileDownload>
}

export interface CustomerApi {
  list(params?: Record<string, unknown>): Promise<CustomerListResponse>
  detail(id: number): Promise<CustomerWire>
  create(data: CustomerCreateRequest): Promise<CustomerWire>
  update(id: number, data: CustomerUpdateRequest): Promise<CustomerWire>
  resetPortalTemporaryPassword(
    id: number,
    data: PortalTemporaryPasswordRequest,
  ): Promise<PortalTemporaryPasswordResult>
  recharge(id: number, data: Record<string, unknown>): Promise<any>
  rechargeHistory(id: number): Promise<unknown[]>
  skuInventory(id: number): Promise<
    { sku: string; productName: string; quantity: number; unitPrice: number | null }[]
  >
}

export const api: ApiGroup
export const authApi: ApiGroup
export const dashboardApi: ApiGroup
export const storeMonitorApi: ApiGroup
export const usersApi: ApiGroup
export const permissionsApi: ApiGroup
export const leadApi: ApiGroup
export const productApi: ApiGroup
export const productDevApi: ApiGroup
export const supplierApi: ApiGroup
export const purchaseApi: ApiGroup
export const inboundApi: ApiGroup
export const returnsApi: ApiGroup
export const inventoryApi: ApiGroup
export const outboundApi: OutboundApi
export const warehouseApi: ApiGroup
export const warehouseZoneApi: ApiGroup
export const locationApi: ApiGroup
export const managementLoopApi: ApiGroup
export const logisticsReceiptApi: ApiGroup
export const pricingApi: ApiGroup
export const costApi: ApiGroup
export const syncApi: ApiGroup
export const operationLogApi: ApiGroup
export const customerApi: CustomerApi
export const billingApi: ApiGroup
export const freightBillApi: ApiGroup
export const mingruiApi: ApiGroup
export const profitApi: ApiGroup
export const operatingLedgerApi: ApiGroup
export const announcementApi: ApiGroup
export const asyncIoApi: ApiGroup

export default api
