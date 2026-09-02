"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DASHBOARD_WIDGET_PERMS = exports.DASHBOARD_VIEW_PERM = exports.DASHBOARD_PIPELINE_OVERSEAS_PERM = exports.DASHBOARD_PIPELINE_DOMESTIC_PERM = exports.DASHBOARD_TRENDS_PERM = exports.DASHBOARD_KPI_LABELS = exports.DASHBOARD_KPI_PERM_MAP = void 0;
exports.filterDashboardStats = filterDashboardStats;
/** 工作台 KPI 字段 → 权限码 */
exports.DASHBOARD_KPI_PERM_MAP = {
    inventoryAvailable: 'dashboard.kpi_inventory',
    products: 'dashboard.kpi_products',
    suppliers: 'dashboard.kpi_suppliers',
    leads: 'dashboard.kpi_leads',
    pendingPo: 'dashboard.kpi_purchase',
    pendingAudit: 'dashboard.kpi_audit',
    syncFailed: 'dashboard.kpi_sync',
};
exports.DASHBOARD_KPI_LABELS = {
    inventoryAvailable: '可用库存',
    products: '商品 SKU',
    suppliers: '活跃供应商',
    leads: '线索总数',
    pendingPo: '待审 PO',
    pendingAudit: '待审选品',
    syncFailed: '同步失败',
};
exports.DASHBOARD_TRENDS_PERM = 'dashboard.trends_logistics';
exports.DASHBOARD_PIPELINE_DOMESTIC_PERM = 'dashboard.pipeline_domestic';
exports.DASHBOARD_PIPELINE_OVERSEAS_PERM = 'dashboard.pipeline_overseas';
exports.DASHBOARD_VIEW_PERM = 'dashboard.view';
exports.DASHBOARD_WIDGET_PERMS = [
    exports.DASHBOARD_VIEW_PERM,
    ...Object.values(exports.DASHBOARD_KPI_PERM_MAP),
    exports.DASHBOARD_TRENDS_PERM,
    exports.DASHBOARD_PIPELINE_DOMESTIC_PERM,
    exports.DASHBOARD_PIPELINE_OVERSEAS_PERM,
];
function filterDashboardStats(stats, allowed) {
    const out = {};
    for (const [key, perm] of Object.entries(exports.DASHBOARD_KPI_PERM_MAP)) {
        if (allowed.has(perm) && stats[key] != null)
            out[key] = stats[key];
    }
    return out;
}
//# sourceMappingURL=dashboard-widgets.js.map