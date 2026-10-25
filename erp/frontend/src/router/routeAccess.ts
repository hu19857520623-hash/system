import type { NavigationGuard } from 'vue-router'
import { internalRedirect } from '../auth/internalRedirect'

export const ROUTE_SCREENS: Record<string, string | readonly string[]> = {
  LeadsPool: 'leads_pool', LeadsMine: 'leads_mine', LeadsFollow: 'leads_follow', LeadsDeals: 'leads_deals', LeadsReports: 'leads_reports',
  Products: 'products', ProductDev: 'product_dev', ProductAudit: 'product_audit', Suppliers: 'suppliers', Purchase: 'purchase',
  LogisticsWh: 'logistics_wh', LogisticsInventory: 'logistics_inventory', Mingrui: 'mingrui', WarehouseLocations: 'warehouse_locations', TakealotDest: 'takealot_dest',
  CreateInbound: 'create_inbound', InboundArrivalScan: ['inbound', 'inbound_arrival'], InboundReceipt: 'inbound', ReturnManagement: 'returns', Outbound: 'outbound',
  Pricing: 'pricing', InventoryQuery: 'inventory_query', SkuQuery: 'sku_query', AnhengScale: 'anheng', WmsReports: 'wms_reports', Stocktake: 'stocktake', Capacity: 'capacity',
  SyncLog: 'sync', OperationLog: 'operation_log', Billing: 'billing', Customers: 'customers', CustomerRecharge: 'budget_credit', FinanceBooks: 'finance_books', StoreMonitor: 'store_monitor', AsyncIo: 'async_io', Permissions: 'permissions',
}
export const ACCOUNT_ROUTES = new Set(['Login', 'Dashboard', 'ProfileSettings', 'AccessDenied', 'NotFound'])
export type RouteAccess = { authenticatedUser: { roleCode: string } | null; canViewScreen: (screen: string) => boolean }
type GuardApp = RouteAccess & { authReady: boolean; isAuthenticated: boolean; initAuth: () => Promise<unknown> }

export function isRouteAllowed(route: { name?: string | symbol | null }, app: RouteAccess): boolean {
  const name = typeof route.name === 'string' ? route.name : ''
  if (ACCOUNT_ROUTES.has(name)) return true
  if (name === 'FlowDebug') return app.authenticatedUser?.roleCode === 'admin'
  const screens = ROUTE_SCREENS[name]
  if (!screens) return false
  return (typeof screens === 'string' ? [screens] : screens).some(screen => app.canViewScreen(screen))
}

export function createErpRouteGuard(getApp: () => GuardApp): NavigationGuard {
  return async to => {
    const app = getApp()
    if (!app.authReady) await app.initAuth()
    if (!app.isAuthenticated && to.meta.public !== true) return { path: '/login', query: { redirect: internalRedirect(to.fullPath) } }
    if (app.isAuthenticated && to.name === 'Login') return { path: '/dashboard' }
    if (app.isAuthenticated && !isRouteAllowed(to, app)) return { name: 'AccessDenied', query: { redirect: internalRedirect(to.fullPath) }, replace: true }
  }
}
