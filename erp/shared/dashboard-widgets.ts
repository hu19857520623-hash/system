/** 工作台 KPI 字段 → 权限码 */
export const DASHBOARD_KPI_PERM_MAP = {
  inventoryAvailable: 'dashboard.kpi_inventory',
  products: 'dashboard.kpi_products',
  suppliers: 'dashboard.kpi_suppliers',
  leads: 'dashboard.kpi_leads',
  pendingPo: 'dashboard.kpi_purchase',
  pendingAudit: 'dashboard.kpi_audit',
  syncFailed: 'dashboard.kpi_sync',
} as const

export type DashboardKpiKey = keyof typeof DASHBOARD_KPI_PERM_MAP

export const DASHBOARD_KPI_LABELS: Record<DashboardKpiKey, string> = {
  inventoryAvailable: '可用库存',
  products: '商品 SKU',
  suppliers: '活跃供应商',
  leads: '线索总数',
  pendingPo: '待审 PO',
  pendingAudit: '待审选品',
  syncFailed: '同步失败',
}

export const DASHBOARD_TRENDS_PERM = 'dashboard.trends_logistics'
export const DASHBOARD_PIPELINE_DOMESTIC_PERM = 'dashboard.pipeline_domestic'
export const DASHBOARD_PIPELINE_OVERSEAS_PERM = 'dashboard.pipeline_overseas'
export const DASHBOARD_VIEW_PERM = 'dashboard.view'

export const DASHBOARD_WIDGET_PERMS = [
  DASHBOARD_VIEW_PERM,
  ...Object.values(DASHBOARD_KPI_PERM_MAP),
  DASHBOARD_TRENDS_PERM,
  DASHBOARD_PIPELINE_DOMESTIC_PERM,
  DASHBOARD_PIPELINE_OVERSEAS_PERM,
] as const

export function filterDashboardStats<T extends Record<string, number>>(
  stats: T,
  allowed: Set<string>,
): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, perm] of Object.entries(DASHBOARD_KPI_PERM_MAP) as [DashboardKpiKey, string][]) {
    if (allowed.has(perm) && stats[key] != null) out[key as keyof T] = stats[key as keyof T]
  }
  return out
}
