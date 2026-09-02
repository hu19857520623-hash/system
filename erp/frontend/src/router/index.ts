import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAppStore } from '@/stores/app'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('@/pages/DashboardView.vue'), meta: { title: '工作台', section: '概览' } },
      // 获客与销售
      { path: 'leads/pool', name: 'LeadsPool', component: () => import('@/pages/LeadsPoolView.vue'), meta: { title: '线索池', section: '获客与销售' } },
      { path: 'leads/follow', name: 'LeadsFollow', component: () => import('@/pages/LeadsFollowView.vue'), meta: { title: '我的跟进', section: '获客与销售' } },
      { path: 'leads/deals', name: 'LeadsDeals', component: () => import('@/pages/LeadsDealsView.vue'), meta: { title: '成交管理', section: '获客与销售' } },
      { path: 'leads/reports', name: 'LeadsReports', component: () => import('@/pages/LeadsReportsView.vue'), meta: { title: '获客报表', section: '获客与销售' } },
      // 主链路
      { path: 'products', name: 'Products', component: () => import('@/pages/ProductsView.vue'), meta: { title: '商品主数据', section: '主链路' } },
      { path: 'product-dev', name: 'ProductDev', component: () => import('@/pages/ProductDevView.vue'), meta: { title: '产品开发', section: '主链路' } },
      { path: 'product-audit', name: 'ProductAudit', component: () => import('@/pages/ProductAuditView.vue'), meta: { title: '产品审核', section: '主链路' } },
      { path: 'suppliers', name: 'Suppliers', component: () => import('@/pages/SuppliersView.vue'), meta: { title: '供应商管理', section: '国内 · 采购' } },
      { path: 'purchase', name: 'Purchase', component: () => import('@/pages/PurchaseView.vue'), meta: { title: '采购订单', section: '国内 · 采购' } },
      { path: 'logistics-wh', name: 'LogisticsWh', component: () => import('@/pages/LogisticsWhView.vue'), meta: { title: '物流中转仓', section: '国内 · 物流中转' } },
      { path: 'logistics-inventory', name: 'LogisticsInventory', component: () => import('@/pages/LogisticsInventoryView.vue'), meta: { title: '中转仓库存查询', section: '国内 · 物流中转' } },
      { path: 'mingrui', name: 'Mingrui', component: () => import('@/pages/MingruiView.vue'), meta: { title: '明瑞物流', section: '国内 · 物流中转' } },
      { path: 'warehouse/locations', name: 'WarehouseLocations', component: () => import('@/pages/WarehouseLocationView.vue'), meta: { title: '库位管理', section: '海外仓 · 仓储作业' } },
      { path: 'inbound/create', name: 'CreateInbound', component: () => import('@/pages/CreateInboundView.vue'), meta: { title: '发运海外仓', section: '国内 · 物流中转' } },
      { path: 'inbound/arrival-scan', name: 'InboundArrivalScan', component: () => import('@/pages/InboundArrivalScanView.vue'), meta: { title: '到仓扫描', section: '海外仓 · 仓储作业' } },
      { path: 'inbound/receipt', name: 'InboundReceipt', component: () => import('@/pages/InboundReceiptView.vue'), meta: { title: '入库单管理', section: '海外仓 · 仓储作业' } },
      { path: 'returns', name: 'ReturnManagement', component: () => import('@/pages/ReturnManagementView.vue'), meta: { title: '退件管理', section: '海外仓 · 仓储作业' } },
      { path: 'inbound/putaway', redirect: { path: '/inbound/arrival-scan', query: { step: 'putaway' } } },
      { path: 'outbound', name: 'Outbound', component: () => import('@/pages/OutboundView.vue'), meta: { title: '出库单管理', section: '海外仓 · 仓储作业' } },
      { path: 'outbound/create', redirect: '/outbound' },
      { path: 'pricing', name: 'Pricing', component: () => import('@/pages/PricingView.vue'), meta: { title: '货盘库存', section: '运营' } },
      { path: 'inventory', name: 'InventoryQuery', component: () => import('@/pages/InventoryQueryView.vue'), meta: { title: '库存查询', section: '海外仓 · 仓储作业' } },
      { path: 'inventory/sku-query', name: 'SkuQuery', component: () => import('@/pages/SkuQueryView.vue'), meta: { title: 'SKU 查询', section: '海外仓 · 仓储作业' } },
      { path: 'warehouse/anheng', name: 'AnhengScale', component: () => import('@/pages/AnhengScaleView.vue'), meta: { title: '安衡测量仪', section: '海外仓 · 仓储作业' } },
      { path: 'wms/reports', name: 'WmsReports', component: () => import('@/pages/ManagementLoopView.vue'), meta: { title: '作业报表', section: '海外仓 · 管理闭环', tab: 'reports' } },
      { path: 'wms/stocktake', name: 'Stocktake', component: () => import('@/pages/ManagementLoopView.vue'), meta: { title: '盘点管理', section: '海外仓 · 管理闭环', tab: 'stocktake' } },
      { path: 'wms/capacity', name: 'Capacity', component: () => import('@/pages/ManagementLoopView.vue'), meta: { title: '容量预警', section: '海外仓 · 管理闭环', tab: 'capacity' } },
      { path: 'wms/inbound-fees', redirect: '/wms/reports' },
      { path: 'cost', name: 'CostLedger', component: () => import('@/pages/CostLedgerView.vue'), meta: { title: '成本台账', section: '财务' } },
      { path: 'operating-ledger', name: 'OperatingLedger', component: () => import('@/pages/OperatingLedgerView.vue'), meta: { title: '经营收支', section: '财务' } },
      { path: 'sync', name: 'SyncLog', component: () => import('@/pages/SyncLogView.vue'), meta: { title: '同步日志', section: '同步' } },
      { path: 'operation-logs', name: 'OperationLog', component: () => import('@/pages/OperationLogView.vue'), meta: { title: '操作日志', section: '同步' } },
      // 财务
      { path: 'billing', name: 'Billing', component: () => import('@/pages/BillingView.vue'), meta: { title: '客户结算', section: '财务' } },
      { path: 'customers', name: 'Customers', component: () => import('@/pages/CustomerListView.vue'), meta: { title: '客户列表', section: '财务' } },
      { path: 'customer-recharge', name: 'CustomerRecharge', component: () => import('@/pages/CustomerRechargeView.vue'), meta: { title: '客户充值', section: '财务' } },
      { path: 'supplier-freight', name: 'SupplierSeaFreightBill', component: () => import('@/pages/SupplierSeaFreightBillView.vue'), meta: { title: '海运账单', section: '财务' } },
      // 运营
      { path: 'reports', redirect: '/profit-analysis' },
      { path: 'profit-analysis', name: 'ProfitAnalysis', component: () => import('@/pages/ProfitAnalysisView.vue'), meta: { title: '利润/采购分析', section: '财务' } },
      { path: 'store-monitor', name: 'StoreMonitor', component: () => import('@/pages/StoreMonitorView.vue'), meta: { title: '店铺监控', section: '运营' } },
      // 系统
      { path: 'async-io', name: 'AsyncIo', component: () => import('@/pages/AsyncIoView.vue'), meta: { title: '异步导出导入', section: '系统' } },
      { path: 'permissions', name: 'Permissions', component: () => import('@/pages/UserManagementView.vue'), meta: { title: '用户管理', section: '系统' } },
      { path: 'user-management', redirect: '/permissions' },
      { path: 'settings/profile', name: 'ProfileSettings', component: () => import('@/pages/ProfileSettingsView.vue'), meta: { title: '个人设置', section: '系统' } },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const app = useAppStore()
  if (!app.authReady) await app.initAuth()

  const isPublic = to.meta.public === true
  if (!app.isAuthenticated && !isPublic) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (app.isAuthenticated && to.path === '/login') {
    return { path: '/dashboard' }
  }
})

export default router
