/** 工作台 KPI 字段 → 权限码 */
export declare const DASHBOARD_KPI_PERM_MAP: {
    readonly inventoryAvailable: "dashboard.kpi_inventory";
    readonly products: "dashboard.kpi_products";
    readonly suppliers: "dashboard.kpi_suppliers";
    readonly leads: "dashboard.kpi_leads";
    readonly pendingPo: "dashboard.kpi_purchase";
    readonly pendingAudit: "dashboard.kpi_audit";
    readonly syncFailed: "dashboard.kpi_sync";
};
export type DashboardKpiKey = keyof typeof DASHBOARD_KPI_PERM_MAP;
export declare const DASHBOARD_KPI_LABELS: Record<DashboardKpiKey, string>;
export declare const DASHBOARD_TRENDS_PERM = "dashboard.trends_logistics";
export declare const DASHBOARD_PIPELINE_DOMESTIC_PERM = "dashboard.pipeline_domestic";
export declare const DASHBOARD_PIPELINE_OVERSEAS_PERM = "dashboard.pipeline_overseas";
export declare const DASHBOARD_VIEW_PERM = "dashboard.view";
export declare const DASHBOARD_WIDGET_PERMS: readonly ["dashboard.view", ...("dashboard.kpi_inventory" | "dashboard.kpi_products" | "dashboard.kpi_suppliers" | "dashboard.kpi_leads" | "dashboard.kpi_purchase" | "dashboard.kpi_audit" | "dashboard.kpi_sync")[], "dashboard.trends_logistics", "dashboard.pipeline_domestic", "dashboard.pipeline_overseas"];
export declare function filterDashboardStats<T extends Record<string, number>>(stats: T, allowed: Set<string>): Partial<T>;
