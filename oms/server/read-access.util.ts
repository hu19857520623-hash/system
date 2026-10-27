import { canReadData, type DataResource, type ReadIdentity } from '../src/data/readAccess.js'

export function readResourceForPath(method: string, value: string): DataResource | null {
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) return null
  const path = value.split('?')[0].replace(/\/+$/, '') || '/'
  if (/^\/erp\/customers\/[^/]+\/(billing-snapshot|charges|bills)$/.test(path) || path === '/billing') return 'billing'
  if (/^\/erp\/customers\/[^/]+\/recharges$/.test(path)) return 'recharges'
  if (/^\/erp\/customers\/[^/]+(?:\/balance)?$/.test(path)) return 'balance'
  if (/^\/erp\/customers\/[^/]+\/(inventory-view|sku-inventory)$/.test(path)) return 'inventory'
  if (/^\/erp\/inbound(?:\/|$)/.test(path)) return 'inboundOrders'
  if (/^\/erp\/outbound(?:\/|$)/.test(path)) return 'outboundOrders'
  if (/^\/erp\/returns(?:\/|$)/.test(path)) return 'returnOrders'
  if (/^\/erp\/logistics(?:\/|$)/.test(path)) return 'logistics'
  if (/^\/erp\/catalog(?:\/|$)/.test(path)) return 'catalog'
  if (path === '/system-messages' || path === '/erp/announcements') return 'messages'
  return null
}

export function assertApiReadAccess(identity: ReadIdentity, method: string, path: string) {
  const resource = readResourceForPath(method, path)
  return !resource || canReadData(identity, resource)
}

/** Apply after customer isolation; permissions never broaden the customer scope. */
export function filterBootstrapReads<T extends Record<string, any>>(data: T, identity: ReadIdentity): T {
  if (identity.role === 'sys_admin') return data
  const result: Record<string, any> = { ...data }
  for (const key of ['products', 'inventory', 'orders', 'inboundOrders', 'outboundOrders', 'returnOrders', 'logistics', 'platformSkuMappings', 'stores', 'purchases'] as const) {
    if (!canReadData(identity, key)) result[key] = []
  }
  if (!canReadData(identity, 'messages')) { result.systemMessages = []; result.announcements = [] }
  if (!canReadData(identity, 'billing')) {
    result.feeRecords = []; result.billingAccounts = []
    result.billing = canReadData(identity, 'balance') && data.billing ? {
      creditBalance: data.billing.creditBalance, readWarning: data.billing.readWarning,
      name: data.billing.name, code: data.billing.code, contact: data.billing.contact, warehouse: data.billing.warehouse,
    } : null
  }
  return result as T
}
