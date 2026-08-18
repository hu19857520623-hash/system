/**
 * ERP 权限单源配置（1P）
 * 后端 permissions.constants、前端 app.ts ROLE_TEMPLATES、UserManagementView PERM_GROUPS 均由此导出。
 */

export interface PermissionItem {
  id: string
  label: string
}

export interface PermissionGroup {
  label: string
  perms: PermissionItem[]
}

/** 权限分组（管理页勾选 UI + sys_permission 中文名） */
export const PERM_GROUPS: PermissionGroup[] = [
  {
    label: '获客与销售',
    perms: [
      { id: 'leads_pool.view', label: '线索池-查看' },
      { id: 'leads_pool.create', label: '线索池-新建' },
      { id: 'leads_pool.assign', label: '线索池-分配销售' },
      { id: 'leads_pool.view_all', label: '线索池-查看全部销售' },
      { id: 'leads_follow.view', label: '我的跟进-查看' },
      { id: 'leads_follow.edit', label: '我的跟进-编辑' },
      { id: 'leads_deals.view', label: '成交管理-查看' },
      { id: 'leads_deals.edit', label: '成交管理-编辑' },
      { id: 'leads_reports.view', label: '获客报表-查看' },
    ],
  },
  {
    label: '商品与选品',
    perms: [
      { id: 'products.view', label: '商品主数据-查看' },
      { id: 'products.edit', label: '商品主数据-编辑' },
      { id: 'products.import', label: '商品主数据-导入' },
      { id: 'product_dev.view', label: '产品开发-查看' },
      { id: 'product_dev.create', label: '产品开发-新建' },
      { id: 'product_dev.edit', label: '产品开发-编辑' },
      { id: 'product_audit.view', label: '产品审核-查看' },
      { id: 'product_audit.approve', label: '产品审核-通过' },
      { id: 'product_audit.reject', label: '产品审核-驳回' },
      { id: 'product_audit.label', label: '产品审核-标签' },
      { id: 'product_audit.purchase_qty', label: '产品审核-采购数量' },
    ],
  },
  {
    label: '采购与入库',
    perms: [
      { id: 'suppliers.view', label: '供应商-查看' },
      { id: 'suppliers.edit', label: '供应商-编辑' },
      { id: 'purchase.view', label: '采购订单-查看' },
      { id: 'purchase.create', label: '采购订单-创建' },
      { id: 'purchase.assign', label: '采购订单-需求分配' },
      { id: 'purchase.po_audit', label: '采购订单-主管审核/驳回' },
      { id: 'purchase.mark_paid', label: '采购订单-标记打款' },
      { id: 'logistics_wh.view', label: '物流仓库-查看' },
      { id: 'logistics_wh.receive', label: '物流仓库-收货' },
      { id: 'logistics_wh.manage', label: '物流仓库-管理' },
      { id: 'create_inbound.view', label: '创建入库单-查看' },
      { id: 'create_inbound.create', label: '创建入库单-创建' },
      { id: 'create_inbound.label', label: '创建入库单-标签' },
      { id: 'mingrui.view', label: '明瑞物流-查看' },
      { id: 'mingrui.order', label: '明瑞物流-下单' },
      { id: 'warehouse_location.view', label: '库位管理-查看' },
      { id: 'warehouse_location.edit', label: '库位管理-编辑' },
      { id: 'warehouse_location.batch_create', label: '库位管理-批量生成' },
      { id: 'inbound.view', label: '入库单管理-查看' },
      { id: 'inbound.arrival_scan', label: '入库-到仓扫描' },
      { id: 'inbound.receive', label: '入库-开始收货' },
      { id: 'inbound.qc', label: '入库-清点' },
      { id: 'inbound.putaway', label: '入库-上架' },
      { id: 'inbound.handle_exception', label: '入库-异常放行' },
      { id: 'inbound.confirm_diff', label: '入库单管理-确认差异' },
      { id: 'return.view', label: '退件管理-查看' },
      { id: 'return.receive', label: '退件管理-确认收货' },
      { id: 'return.process', label: '退件管理-处理完成' },
    ],
  },
  {
    label: '出库作业',
    perms: [
      { id: 'outbound.view', label: '出库单-查看' },
      { id: 'outbound.create', label: '出库单-创建' },
      { id: 'outbound.relabel', label: '出库-换标确认' },
      { id: 'outbound.pick', label: '出库-拣货' },
      { id: 'outbound.pack', label: '出库-打包' },
      { id: 'outbound.ship', label: '出库-发运' },
    ],
  },
  {
    label: '定价与库存',
    perms: [
      { id: 'pricing.view', label: '货盘库存-查看' },
      { id: 'pricing.set', label: '货盘库存-定价' },
      { id: 'pricing.sync_oms', label: '货盘库存-同步OMS' },
      { id: 'pricing.freight_callback', label: '货盘库存-海运费回传(已废弃)' },
      { id: 'inventory_query.view', label: '库存查询-查看' },
      { id: 'inventory_query.detail', label: '库存查询-详情' },
      { id: 'inventory_query.adjust', label: '库存查询-调整库位' },
    ],
  },
  {
    label: '财务与运营',
    perms: [
      { id: 'cost.view', label: '成本台账-查看' },
      { id: 'sync.view', label: '同步日志-查看' },
      { id: 'sync.retry', label: '同步日志-重试' },
      { id: 'operation_log.view', label: '操作日志-查看' },
      { id: 'billing.view', label: '客户结算-查看' },
      { id: 'billing.generate', label: '客户结算-生成' },
      { id: 'billing.manual', label: '客户结算-手工' },
      { id: 'receivable_payable.view', label: '海运账单-查看' },
      { id: 'receivable_payable.manual', label: '海运账单-手工' },
      { id: 'reports.view', label: '经营报表-查看' },
      { id: 'profit_analysis.view', label: '利润分析-查看' },
      { id: 'budget_credit.view', label: '客户充值-查看' },
      { id: 'budget_credit.create', label: '客户充值-创建' },
    ],
  },
  {
    label: '店铺监控',
    perms: [
      { id: 'store_monitor.view', label: '店铺监控-查看' },
      { id: 'store_monitor.view_all', label: '店铺监控-查看全部' },
      { id: 'store_monitor.assign', label: '店铺监控-分配陪跑' },
      { id: 'store_monitor.manage', label: '店铺监控-配置API' },
    ],
  },
  {
    label: '系统',
    perms: [
      { id: 'async_io.import', label: '异步导入' },
      { id: 'async_io.export', label: '异步导出' },
      { id: 'permissions.view', label: '权限管理-查看' },
      { id: 'permissions.manage', label: '权限管理-管理' },
      { id: 'announcement.manage', label: '系统公告-发布' },
    ],
  },
]

/** 已废弃权限码（WMS 推送等），读取/写入时自动剔除 */
export const DEPRECATED_PERM_CODES: readonly string[] = [
  'create_inbound.push',
]

/** 旧码 → 新码；值为 null 表示直接删除 */
export const PERM_ALIASES: Record<string, string | null> = {
  'create_inbound.push': null,
}

/** 角色默认权限模板（按中文角色名） */
export const ROLE_PERM_TEMPLATES: Record<string, string[]> = {
  系统管理员: [
    'leads_pool.view', 'leads_pool.create', 'leads_pool.assign', 'leads_pool.view_all', 'leads_follow.view', 'leads_follow.edit',
    'leads_deals.view', 'leads_deals.edit', 'leads_reports.view',
    'products.view', 'products.edit', 'products.import',
    'product_dev.view', 'product_dev.create', 'product_dev.edit',
    'pricing.view', 'pricing.set', 'pricing.sync_oms', 'pricing.freight_callback',
    'product_audit.view', 'product_audit.approve', 'product_audit.reject', 'product_audit.label', 'product_audit.purchase_qty',
    'suppliers.view', 'suppliers.edit',
    'purchase.view', 'purchase.create', 'purchase.assign', 'purchase.po_audit', 'purchase.mark_paid',
    'logistics_wh.view', 'logistics_wh.receive', 'logistics_wh.manage',
    'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
    'mingrui.view', 'mingrui.order',
    'warehouse_location.view', 'warehouse_location.edit', 'warehouse_location.batch_create',
    'inbound.view', 'inbound.arrival_scan', 'inbound.receive', 'inbound.qc', 'inbound.putaway', 'inbound.handle_exception', 'inbound.confirm_diff',
    'return.view', 'return.receive', 'return.process',
    'outbound.view', 'outbound.create', 'outbound.relabel', 'outbound.pick', 'outbound.pack', 'outbound.ship',
    'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
    'cost.view', 'sync.view', 'sync.retry', 'operation_log.view',
    'billing.view', 'billing.generate', 'billing.manual',
    'receivable_payable.view', 'receivable_payable.manual',
    'reports.view',
    'profit_analysis.view',
    'budget_credit.view', 'budget_credit.create',
    'async_io.import', 'async_io.export',
    'permissions.view', 'permissions.manage', 'announcement.manage',
    'store_monitor.view', 'store_monitor.view_all', 'store_monitor.manage', 'store_monitor.assign',
  ],
  采购主管: [
    'products.view', 'suppliers.view', 'suppliers.edit',
    'pricing.view', 'pricing.freight_callback',
    'purchase.view', 'purchase.create', 'purchase.assign', 'purchase.po_audit', 'purchase.mark_paid',
    'logistics_wh.view', 'logistics_wh.receive', 'logistics_wh.manage',
    'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
    'mingrui.view', 'mingrui.order',
    'warehouse_location.view', 'warehouse_location.edit', 'warehouse_location.batch_create',
    'inbound.view', 'inbound.arrival_scan', 'inbound.receive', 'inbound.qc', 'inbound.putaway', 'inbound.handle_exception', 'inbound.confirm_diff',
    'outbound.view', 'outbound.create', 'outbound.relabel', 'outbound.pick', 'outbound.pack', 'outbound.ship',
    'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
    'cost.view', 'sync.view', 'sync.retry', 'operation_log.view',
    'profit_analysis.view',
    'async_io.import', 'async_io.export',
  ],
  采购: [
    'products.view', 'suppliers.view',
    'pricing.view', 'pricing.freight_callback',
    'purchase.view', 'purchase.create', 'purchase.mark_paid',
    'logistics_wh.view', 'logistics_wh.receive',
    'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
    'mingrui.view',
    'warehouse_location.view',
    'inbound.view', 'inventory_query.view', 'inventory_query.detail',
    'outbound.view', 'outbound.create',
    'sync.view',
  ],
  销售: [
    'leads_pool.view', 'leads_pool.create',
    'leads_follow.view', 'leads_follow.edit',
    'leads_deals.view', 'leads_deals.edit',
    'leads_reports.view',
  ],
  销售主管: [
    'leads_pool.view', 'leads_pool.create', 'leads_pool.assign', 'leads_pool.view_all',
    'leads_follow.view', 'leads_follow.edit',
    'leads_deals.view', 'leads_deals.edit',
    'leads_reports.view',
    'operation_log.view', 'async_io.export',
  ],
  财务: [
    'products.view',
    'purchase.view',
    'cost.view',
    'billing.view', 'billing.generate', 'billing.manual',
    'receivable_payable.view', 'receivable_payable.manual',
    'reports.view', 'profit_analysis.view',
    'budget_credit.view', 'budget_credit.create',
    'async_io.export',
  ],
  产品开发主管: [
    'products.view', 'products.edit', 'products.import',
    'product_dev.view', 'product_dev.create', 'product_dev.edit',
    'product_audit.view', 'product_audit.approve', 'product_audit.reject', 'product_audit.label', 'product_audit.purchase_qty',
    'pricing.view', 'pricing.set',
    'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
    'operation_log.view',
    'async_io.import', 'async_io.export',
    'store_monitor.view', 'store_monitor.view_all', 'store_monitor.assign',
  ],
  产品开发: [
    'products.view',
    'product_dev.view', 'product_dev.create', 'product_dev.edit',
    'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
    'store_monitor.view', 'store_monitor.view_all',
  ],
  陪跑: [
    'products.view',
    'pricing.view', 'pricing.set', 'pricing.sync_oms',
    'inventory_query.view',
  ],
  陪跑1: [
    'products.view',
    'pricing.view', 'pricing.set', 'pricing.sync_oms',
    'inventory_query.view',
    'store_monitor.view',
  ],
  陪跑2: [
    'products.view',
    'pricing.view', 'pricing.set', 'pricing.sync_oms',
    'inventory_query.view',
    'store_monitor.view',
  ],
  仓库: [
    'logistics_wh.view', 'logistics_wh.receive', 'logistics_wh.manage',
    'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
    'warehouse_location.view', 'warehouse_location.edit', 'warehouse_location.batch_create',
    'inbound.view', 'inbound.arrival_scan', 'inbound.receive', 'inbound.qc', 'inbound.putaway', 'inbound.handle_exception', 'inbound.confirm_diff',
    'outbound.view', 'outbound.create', 'outbound.relabel', 'outbound.pick', 'outbound.pack', 'outbound.ship',
    'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
    'sync.view', 'sync.retry', 'operation_log.view',
  ],
}

/** 后端 roleCode → 权限模板名 */
export const ROLE_CODE_TEMPLATE: Record<string, string> = {
  admin: '系统管理员',
  ops_manager: '采购主管',
  purchaser: '采购',
  finance: '财务',
  cs: '销售',
  sales_manager: '销售主管',
  coach: '陪跑',
  coach1: '陪跑1',
  coach2: '陪跑2',
  viewer: '产品开发',
  warehouse: '仓库',
  dev_manager: '产品开发主管',
}

/** 角色元数据（种子 / 管理页） */
export const ROLE_DEFINITIONS = [
  { roleCode: 'admin', roleName: '系统管理员', templateKey: '系统管理员', description: '拥有全部权限' },
  { roleCode: 'ops_manager', roleName: '采购主管', templateKey: '采购主管', description: 'PO 审核、明瑞物流下单与入库协调' },
  { roleCode: 'purchaser', roleName: '采购', templateKey: '采购', description: '采购下单与创建入库单' },
  { roleCode: 'warehouse', roleName: '仓库', templateKey: '仓库', description: '收货、清点、上架与库位' },
  { roleCode: 'finance', roleName: '财务', templateKey: '财务', description: '查看已打款采购单与结算' },
  { roleCode: 'cs', roleName: '销售', templateKey: '销售', description: '线索跟进与成交' },
  { roleCode: 'sales_manager', roleName: '销售主管', templateKey: '销售主管', description: '线索分配、团队跟进与销售报表' },
  { roleCode: 'dev_manager', roleName: '产品开发主管', templateKey: '产品开发主管', description: '选品审核' },
  { roleCode: 'viewer', roleName: '产品开发', templateKey: '产品开发', description: '选品提交' },
  { roleCode: 'coach', roleName: '陪跑', templateKey: '陪跑', description: '定价与 OMS 同步' },
  { roleCode: 'coach1', roleName: '陪跑1', templateKey: '陪跑1', description: '店铺监控 1-5' },
  { roleCode: 'coach2', roleName: '陪跑2', templateKey: '陪跑2', description: '店铺监控 6-9,0' },
] as const

/** 可被分配为线索归属人的销售角色 */
export const LEAD_ASSIGNEE_ROLE_CODES = ['cs', 'sales', 'sales_manager'] as const

/** 新建线索时强制归属当前登录人的销售角色（不含销售主管） */
export const LEAD_SELF_ASSIGN_ROLE_CODES = ['cs', 'sales'] as const

const PERM_LABEL_MAP = new Map(
  PERM_GROUPS.flatMap((g) => g.perms.map((p) => [p.id, p.label] as const)),
)

export const ALL_PERM_CODES: string[] = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.id))

export const STORE_MONITOR_ASSIGN_PERM = 'store_monitor.assign'

export function permLabel(code: string): string {
  return PERM_LABEL_MAP.get(code) || code
}

export function permModule(code: string): string {
  return code.split('.')[0] || code
}

/** 剔除废弃码、应用别名，仅保留 catalog 中存在的权限 */
export function normalizePermCodes(codes: string[]): string[] {
  const valid = new Set(ALL_PERM_CODES)
  const out = new Set<string>()
  for (const raw of codes) {
    if (!raw) continue
    if (DEPRECATED_PERM_CODES.includes(raw)) continue
    const alias = PERM_ALIASES[raw]
    if (alias === null) continue
    const resolved = alias ?? raw
    if (valid.has(resolved)) out.add(resolved)
  }
  return [...out]
}

export function defaultPermsForRoleCode(roleCode: string): string[] {
  const key = ROLE_CODE_TEMPLATE[roleCode]
  if (!key) return []
  return normalizePermCodes(ROLE_PERM_TEMPLATES[key] || [])
}

export function templatePermsForRoleName(roleName: string): string[] {
  const alias: Record<string, string> = {
    客服: '销售',
    运营主管: '采购主管',
    采购员: '采购',
    访客: '产品开发',
    仓库管理员: '仓库',
  }
  const key = alias[roleName] || roleName
  return normalizePermCodes(ROLE_PERM_TEMPLATES[key] || [])
}
