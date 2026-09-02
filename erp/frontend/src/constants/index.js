/**
 * 全局常量配置
 */

/** 路由名称与路径映射 */
export const ROUTE_MAP = {
  dashboard: '/dashboard',
  products: '/products',
  suppliers: '/suppliers',
  purchase: '/purchase',
  product_dev: '/product-dev',
  product_audit: '/product-audit',
  logistics_wh: '/logistics-wh',
  logistics_inventory: '/logistics-inventory',
  mingrui: '/mingrui',
  create_inbound: '/inbound/create',
  inbound_receipt: '/inbound/receipt',
  inventory_query: '/inventory',
  sku_query: '/inventory/sku-query',
  cost: '/cost',
  sync: '/sync',
  billing: '/billing',
  reports: '/profit-analysis',
  profit_analysis: '/profit-analysis',
  customer_recharge: '/customer-recharge',
  customers: '/customers',
  supplier_sea_freight_bill: '/supplier-sea-freight-bill',
  leads_pool: '/leads/pool',
  leads_follow: '/leads/follow',
  leads_deals: '/leads/deals',
  leads_reports: '/leads/reports',
  async_io: '/async-io',
  permissions: '/permissions',
}

/** 采购单状态 */
export const PO_STATUS = {
  pending_po_audit: { label: '待采购审核', type: 'warning' },
  finance_approved: { label: '待中转仓收货', type: 'warning' },
  at_logistics_wh: { label: '中转仓部分收货', type: 'info' },
  wms: { label: '海外仓在途', type: 'info' },
  received: { label: '中转仓已收齐', type: 'success' },
}

/** 仓库类型（DB 字段 warehouse_type；API 查询可用 overseas 作为 wms 别名） */
export const WAREHOUSE_TYPE = {
  logistics: { db: 'logistics', label: '物流中转仓' },
  overseas: { db: 'wms', label: '海外仓' },
}

/** 入库单状态 */
export const INBOUND_STATUS = {
  oms_draft: { label: 'OMS草稿', type: 'info' },
  pending_receipt: { label: '在途', type: 'info' },
  arrived: { label: '已到仓', type: 'warning' },
  receiving: { label: '收货中', type: 'warning' },
  pending_putaway: { label: '待上架', type: 'warning' },
  completed: { label: '已入库', type: 'success' },
  exception: { label: '异常', type: 'danger' },
  confirmed: { label: '已入库', type: 'success' },
  // 兼容旧 WMS 推送态（展示同在途）
  pending_push: { label: '在途', type: 'info' },
  push_failed: { label: '在途', type: 'info' },
  pushed: { label: '在途', type: 'info' },
}

/** 待收货态（含 legacy） */
export const INBOUND_PENDING_RECEIPT = new Set([
  'pending_receipt', 'pending_push', 'push_failed', 'pushed',
])

/** 入库单状态 → 列表展示 */
export function getInboundStatusMeta(status) {
  const row = INBOUND_STATUS[status]
  if (!row) return { label: status, type: 'info', tone: 'info' }
  const tone = row.type === 'success' ? 'ok' : row.type === 'danger' ? 'err' : row.type === 'warning' ? 'warn' : 'info'
  return { label: row.label, type: row.type, tone }
}

/** 线索状态 */
export const LEAD_STATUS = {
  new: { label: '新线索', type: 'info' },
  following: { label: '跟进中', type: 'warning' },
  recall: { label: '需要再次跟进', type: 'danger' },
  hot: { label: '意向高', type: 'success' },
  nurture: { label: '暂无意向', type: 'warning' },
  deal: { label: '已成交', type: 'success' },
  lost: { label: '已流失', type: 'info' },
}

/** 选品状态 */
export const PRODUCT_DEV_STATUS = {
  draft: { label: '草稿', type: 'info' },
  submitted: { label: '审核中', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
}

/** 同步状态 */
export const SYNC_STATUS = {
  success: { label: '同步成功', type: 'success' },
  failed: { label: '同步失败', type: 'danger' },
  pending: { label: '待同步', type: 'info' },
  retrying: { label: '重试中', type: 'warning' },
}

/** 角色模板 */
export const ROLE_TEMPLATES = {
  '系统管理员': [
    'dashboard.view', 'products.view', 'products.edit', 'suppliers.view', 'suppliers.edit',
    'purchase.view', 'purchase.edit', 'purchase.approve', 'logistics_wh.view', 'inbound.view',
    'return.view', 'return.receive', 'return.process',
    'inbound.edit', 'inventory.view', 'cost.view', 'sync.view', 'billing.view', 'billing.edit',
    'reports.view', 'profit.view', 'customer_recharge.view', 'leads.view', 'leads.edit',
    'product_dev.view', 'product_dev.edit', 'product_audit.view', 'product_audit.approve',
    'async_io.view', 'permissions.manage',
  ],
  '运营主管': [
    'dashboard.view', 'products.view', 'purchase.view', 'purchase.approve',
    'logistics_wh.view', 'inbound.view', 'return.view', 'inventory.view', 'cost.view', 'sync.view',
    'billing.view', 'reports.view', 'profit.view', 'leads.view', 'leads.edit',
    'product_dev.view', 'product_dev.edit', 'product_audit.view', 'product_audit.approve',
  ],
  '采购员': [
    'dashboard.view', 'products.view', 'suppliers.view', 'purchase.view', 'purchase.edit',
    'logistics_wh.view', 'inbound.view', 'inventory.view', 'product_dev.view', 'product_dev.edit',
  ],
  '仓库管理员': [
    'dashboard.view', 'logistics_wh.view', 'inbound.view', 'inbound.edit', 'return.view', 'return.receive', 'return.process',
    'inventory.view', 'sync.view',
  ],
  '财务': [
    'dashboard.view', 'purchase.view', 'purchase.approve', 'cost.view',
    'billing.view', 'billing.edit', 'reports.view', 'profit.view', 'customer_recharge.view',
  ],
  '客服': [
    'dashboard.view', 'leads.view', 'leads.edit', 'billing.view',
  ],
  '访客': ['dashboard.view'],
}

/** KPI 配色方案 */
export const KPI_TONE = {
  success: '#1f9d92',
  warn: '#c4782b',
  danger: '#c95e60',
  info: '#2563eb',
  default: '#273034',
}
