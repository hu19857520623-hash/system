"use strict";
/**
 * ERP 权限单源配置（SSOT）
 * 后端、Java auth-service、用户管理页均由此导出；改分组/标签后请跑 sync:java-permissions + sync:permissions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORE_MONITOR_ASSIGN_PERM = exports.ALL_PERM_CODES = exports.LEAD_SELF_ASSIGN_ROLE_CODES = exports.LEAD_ASSIGNEE_ROLE_CODES = exports.ROLE_DEFINITIONS = exports.ROLE_CODE_TEMPLATE = exports.ROLE_PERM_TEMPLATES = exports.PERM_ALIASES = exports.DEPRECATED_PERM_CODES = exports.PERM_GROUPS = void 0;
exports.permLabel = permLabel;
exports.permModule = permModule;
exports.normalizePermCodes = normalizePermCodes;
exports.defaultPermsForRoleCode = defaultPermsForRoleCode;
exports.templatePermsForRoleName = templatePermsForRoleName;
/** 按业务模块分组的权限（用户管理勾选 UI + sys_permission 中文名） */
exports.PERM_GROUPS = [
    {
        label: '工作台',
        perms: [
            { id: 'dashboard.view', label: '工作台 · 访问' },
            { id: 'dashboard.kpi_inventory', label: '工作台 · 可用库存指标' },
            { id: 'dashboard.kpi_products', label: '工作台 · 商品 SKU 指标' },
            { id: 'dashboard.kpi_suppliers', label: '工作台 · 活跃供应商指标' },
            { id: 'dashboard.kpi_leads', label: '工作台 · 线索总数指标' },
            { id: 'dashboard.kpi_purchase', label: '工作台 · 待审 PO 指标' },
            { id: 'dashboard.kpi_audit', label: '工作台 · 待审选品指标' },
            { id: 'dashboard.kpi_sync', label: '工作台 · 同步失败指标' },
            { id: 'dashboard.trends_logistics', label: '工作台 · 中转仓收货趋势' },
            { id: 'dashboard.pipeline_domestic', label: '工作台 · 国内供应链看板' },
            { id: 'dashboard.pipeline_overseas', label: '工作台 · 海外仓作业看板' },
        ],
    },
    {
        label: '获客与销售',
        perms: [
            { id: 'leads_pool.view', label: '线索池 · 查看' },
            { id: 'leads_pool.create', label: '线索池 · 新建/导入' },
            { id: 'leads_pool.assign', label: '线索池 · 分配销售' },
            { id: 'leads_pool.view_all', label: '线索池 · 查看全部销售线索' },
            { id: 'leads_follow.view', label: '我的线索/待跟进 · 查看' },
            { id: 'leads_follow.edit', label: '我的线索/待跟进 · 写跟进/成交' },
            { id: 'leads_deals.view', label: '成交管理 · 查看' },
            { id: 'leads_deals.edit', label: '成交管理 · 编辑/上传资料' },
            { id: 'leads_reports.view', label: '获客报表 · 查看' },
        ],
    },
    {
        label: '商品与选品',
        perms: [
            { id: 'products.view', label: '商品主数据 · 查看' },
            { id: 'products.edit', label: '商品主数据 · 编辑' },
            { id: 'products.import', label: '商品主数据 · 导入' },
            { id: 'products.print_label', label: '商品主数据 · 打印 SKU 标签' },
            { id: 'product_dev.view', label: '产品开发 · 查看' },
            { id: 'product_dev.create', label: '产品开发 · 新建' },
            { id: 'product_dev.edit', label: '产品开发 · 编辑' },
            { id: 'product_audit.view', label: '产品审核 · 查看' },
            { id: 'product_audit.approve', label: '产品审核 · 通过' },
            { id: 'product_audit.reject', label: '产品审核 · 驳回' },
            { id: 'product_audit.label', label: '产品审核 · 标签' },
            { id: 'product_audit.purchase_qty', label: '产品审核 · 采购数量' },
        ],
    },
    {
        label: '采购（国内）',
        perms: [
            { id: 'suppliers.view', label: '供应商 · 查看' },
            { id: 'suppliers.edit', label: '供应商 · 编辑' },
            { id: 'purchase.view', label: '采购订单 · 查看' },
            { id: 'purchase.create', label: '采购订单 · 创建' },
            { id: 'purchase.assign', label: '采购订单 · 需求分配' },
            { id: 'purchase.po_audit', label: '采购订单 · 主管审核/驳回' },
            { id: 'purchase.mark_paid', label: '采购订单 · 标记打款' },
            { id: 'purchase.box_label', label: '采购订单 · 下载外箱标' },
        ],
    },
    {
        label: '物流中转（国内）',
        perms: [
            { id: 'logistics_wh.view', label: '物流中转仓 · 查看' },
            { id: 'logistics_wh.receive', label: '物流中转仓 · 收货' },
            { id: 'logistics_wh.manage', label: '物流中转仓 · 管理' },
            { id: 'create_inbound.view', label: '发运海外仓 · 查看' },
            { id: 'create_inbound.create', label: '发运海外仓 · 创建' },
            { id: 'create_inbound.label', label: '发运海外仓 · 标签' },
            { id: 'mingrui.view', label: '明瑞物流 · 查看' },
            { id: 'mingrui.manage', label: '明瑞物流 · 下单/改单' },
        ],
    },
    {
        label: '海外仓储作业',
        perms: [
            { id: 'warehouse_location.view', label: '库位管理 · 查看' },
            { id: 'warehouse_location.edit', label: '库位管理 · 编辑' },
            { id: 'warehouse_location.batch_create', label: '库位管理 · 批量生成' },
            { id: 'inbound.view', label: '入库单 · 查看' },
            { id: 'inbound.arrival_scan', label: '入库 · 到仓扫描' },
            { id: 'inbound.receive', label: '入库 · 开始收货' },
            { id: 'inbound.qc', label: '入库 · 清点' },
            { id: 'inbound.putaway', label: '入库 · 上架' },
            { id: 'inbound.handle_exception', label: '入库 · 异常放行' },
            { id: 'inbound.confirm_diff', label: '入库单 · 确认差异' },
            { id: 'return.view', label: '退件 · 查看' },
            { id: 'return.receive', label: '退件 · 确认收货' },
            { id: 'return.process', label: '退件 · 处理完成' },
            { id: 'outbound.view', label: '出库单 · 查看' },
            { id: 'outbound.create', label: '出库单 · 创建' },
            { id: 'outbound.relabel', label: '出库 · 换标确认' },
            { id: 'outbound.pick', label: '出库 · 拣货' },
            { id: 'outbound.pack', label: '出库 · 打包' },
            { id: 'outbound.ship', label: '出库 · 发运' },
            { id: 'anheng.view', label: '安衡测量仪 · 查看' },
            { id: 'anheng.test', label: '安衡测量仪 · 联调' },
        ],
    },
    {
        label: '库存与盘点',
        perms: [
            { id: 'inventory_query.view', label: '库存查询 · 查看' },
            { id: 'inventory_query.detail', label: '库存查询 · 详情' },
            { id: 'inventory_query.adjust', label: '库存查询 · 调整库位' },
            { id: 'stocktake.view', label: '盘点 · 查看' },
            { id: 'stocktake.create', label: '盘点 · 创建' },
            { id: 'stocktake.count', label: '盘点 · 初盘/复盘' },
            { id: 'stocktake.approve', label: '盘点 · 审批调整' },
            { id: 'capacity.view', label: '容量预警 · 查看' },
            { id: 'capacity.manage', label: '容量预警 · 刷新' },
            { id: 'wms_reports.view', label: '作业报表 · 查看' },
        ],
    },
    {
        label: '运营',
        perms: [
            { id: 'pricing.view', label: '货盘库存 · 查看' },
            { id: 'pricing.set', label: '货盘库存 · 定价' },
            { id: 'pricing.sync_oms', label: '货盘库存 · 同步 OMS' },
            { id: 'store_monitor.view', label: '店铺监控 · 查看' },
            { id: 'store_monitor.view_all', label: '店铺监控 · 查看全部' },
            { id: 'store_monitor.assign', label: '店铺监控 · 分配陪跑' },
            { id: 'store_monitor.manage', label: '店铺监控 · 配置 API' },
        ],
    },
    {
        label: '财务',
        perms: [
            { id: 'cost.view', label: '成本台账 · 查看' },
            { id: 'operating_ledger.view', label: '经营收支 · 查看' },
            { id: 'operating_ledger.manage', label: '经营收支 · 记账' },
            { id: 'billing.view', label: '客户结算 · 查看' },
            { id: 'billing.generate', label: '客户结算 · 生成' },
            { id: 'billing.manual', label: '客户结算 · 手工入账' },
            { id: 'receivable_payable.view', label: '海运账单 · 查看' },
            { id: 'receivable_payable.manual', label: '海运账单 · 手工' },
            { id: 'budget_credit.view', label: '客户充值 · 查看' },
            { id: 'budget_credit.create', label: '客户充值 · 创建' },
            { id: 'profit_analysis.view', label: '利润/采购分析 · 查看' },
            { id: 'reports.view', label: '经营报表 · 查看' },
        ],
    },
    {
        label: '同步与审计',
        perms: [
            { id: 'sync.view', label: '同步日志 · 查看' },
            { id: 'sync.retry', label: '同步日志 · 重试' },
            { id: 'operation_log.view', label: '操作日志 · 查看' },
        ],
    },
    {
        label: '系统',
        perms: [
            { id: 'async_io.import', label: '异步任务 · 导入' },
            { id: 'async_io.export', label: '异步任务 · 导出' },
            { id: 'permissions.view', label: '用户管理 · 查看' },
            { id: 'permissions.manage', label: '用户管理 · 管理' },
            { id: 'announcement.manage', label: '系统公告 · 发布' },
        ],
    },
];
/** 已废弃权限码，读取/写入时自动剔除 */
exports.DEPRECATED_PERM_CODES = [
    'create_inbound.push',
    'mingrui.order',
    'inbound_fee.view',
    'inbound_fee.manage',
    'pricing.freight_callback',
];
/** 旧码 → 新码；值为 null 表示直接删除 */
exports.PERM_ALIASES = {
    'create_inbound.push': null,
    'mingrui.order': 'mingrui.manage',
    'inbound_fee.view': null,
    'inbound_fee.manage': null,
    'pricing.freight_callback': null,
};
/** 角色默认权限模板（按中文角色名） */
exports.ROLE_PERM_TEMPLATES = {
    系统管理员: [
        'dashboard.view', 'dashboard.kpi_inventory', 'dashboard.kpi_products', 'dashboard.kpi_suppliers', 'dashboard.kpi_leads',
        'dashboard.kpi_purchase', 'dashboard.kpi_audit', 'dashboard.kpi_sync', 'dashboard.trends_logistics',
        'dashboard.pipeline_domestic', 'dashboard.pipeline_overseas',
        'leads_pool.view', 'leads_pool.create', 'leads_pool.assign', 'leads_pool.view_all', 'leads_follow.view', 'leads_follow.edit',
        'leads_deals.view', 'leads_deals.edit', 'leads_reports.view',
        'products.view', 'products.edit', 'products.import', 'products.print_label',
        'product_dev.view', 'product_dev.create', 'product_dev.edit',
        'product_audit.view', 'product_audit.approve', 'product_audit.reject', 'product_audit.label', 'product_audit.purchase_qty',
        'suppliers.view', 'suppliers.edit',
        'purchase.view', 'purchase.create', 'purchase.assign', 'purchase.po_audit', 'purchase.mark_paid', 'purchase.box_label',
        'logistics_wh.view', 'logistics_wh.receive', 'logistics_wh.manage',
        'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
        'mingrui.view', 'mingrui.manage',
        'warehouse_location.view', 'warehouse_location.edit', 'warehouse_location.batch_create',
        'inbound.view', 'inbound.arrival_scan', 'inbound.receive', 'inbound.qc', 'inbound.putaway', 'inbound.handle_exception', 'inbound.confirm_diff',
        'return.view', 'return.receive', 'return.process',
        'outbound.view', 'outbound.create', 'outbound.relabel', 'outbound.pick', 'outbound.pack', 'outbound.ship',
        'anheng.view', 'anheng.test',
        'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
        'stocktake.view', 'stocktake.create', 'stocktake.count', 'stocktake.approve',
        'capacity.view', 'capacity.manage', 'wms_reports.view',
        'pricing.view', 'pricing.set', 'pricing.sync_oms',
        'store_monitor.view', 'store_monitor.view_all', 'store_monitor.manage', 'store_monitor.assign',
        'cost.view', 'operating_ledger.view', 'operating_ledger.manage',
        'billing.view', 'billing.generate', 'billing.manual',
        'receivable_payable.view', 'receivable_payable.manual',
        'budget_credit.view', 'budget_credit.create',
        'profit_analysis.view', 'reports.view',
        'sync.view', 'sync.retry', 'operation_log.view',
        'async_io.import', 'async_io.export',
        'permissions.view', 'permissions.manage', 'announcement.manage',
    ],
    采购主管: [
        'dashboard.view', 'dashboard.kpi_inventory', 'dashboard.kpi_products', 'dashboard.kpi_suppliers', 'dashboard.kpi_purchase',
        'dashboard.kpi_audit', 'dashboard.kpi_sync', 'dashboard.trends_logistics', 'dashboard.pipeline_domestic', 'dashboard.pipeline_overseas',
        'products.view', 'suppliers.view', 'suppliers.edit',
        'purchase.view', 'purchase.create', 'purchase.assign', 'purchase.po_audit', 'purchase.mark_paid', 'purchase.box_label',
        'logistics_wh.view', 'logistics_wh.receive', 'logistics_wh.manage',
        'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
        'mingrui.view', 'mingrui.manage',
        'warehouse_location.view', 'warehouse_location.edit', 'warehouse_location.batch_create',
        'inbound.view', 'inbound.arrival_scan', 'inbound.receive', 'inbound.qc', 'inbound.putaway', 'inbound.handle_exception', 'inbound.confirm_diff',
        'return.view', 'return.receive', 'return.process',
        'anheng.view', 'anheng.test',
        'outbound.view', 'outbound.create', 'outbound.relabel', 'outbound.pick', 'outbound.pack', 'outbound.ship',
        'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
        'pricing.view',
        'cost.view', 'sync.view', 'sync.retry', 'operation_log.view',
        'profit_analysis.view',
        'async_io.import', 'async_io.export',
    ],
    采购: [
        'dashboard.view', 'dashboard.kpi_products', 'dashboard.kpi_suppliers', 'dashboard.kpi_purchase', 'dashboard.pipeline_domestic',
        'products.view', 'suppliers.view',
        'purchase.view', 'purchase.create', 'purchase.mark_paid', 'purchase.box_label',
        'logistics_wh.view', 'logistics_wh.receive',
        'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
        'mingrui.view', 'mingrui.manage',
        'warehouse_location.view',
        'inbound.view', 'inventory_query.view', 'inventory_query.detail',
        'outbound.view', 'outbound.create',
        'pricing.view',
        'sync.view',
    ],
    销售: [
        'dashboard.view', 'dashboard.kpi_leads',
        'leads_pool.view', 'leads_pool.create',
        'leads_follow.view', 'leads_follow.edit',
        'leads_deals.view', 'leads_deals.edit',
        'leads_reports.view',
    ],
    销售主管: [
        'dashboard.view', 'dashboard.kpi_leads',
        'leads_pool.view', 'leads_pool.create', 'leads_pool.assign', 'leads_pool.view_all',
        'leads_follow.view', 'leads_follow.edit',
        'leads_deals.view', 'leads_deals.edit',
        'leads_reports.view',
        'operation_log.view', 'async_io.export',
    ],
    财务: [
        'dashboard.view', 'dashboard.kpi_purchase', 'dashboard.kpi_sync', 'dashboard.pipeline_domestic',
        'products.view',
        'purchase.view',
        'cost.view', 'operating_ledger.view', 'operating_ledger.manage',
        'billing.view', 'billing.generate', 'billing.manual',
        'wms_reports.view',
        'receivable_payable.view', 'receivable_payable.manual',
        'reports.view', 'profit_analysis.view',
        'budget_credit.view', 'budget_credit.create',
        'async_io.export',
    ],
    产品开发主管: [
        'dashboard.view', 'dashboard.kpi_products', 'dashboard.kpi_audit', 'dashboard.pipeline_domestic',
        'products.view', 'products.edit', 'products.import', 'products.print_label',
        'product_dev.view', 'product_dev.create', 'product_dev.edit',
        'product_audit.view', 'product_audit.approve', 'product_audit.reject', 'product_audit.label', 'product_audit.purchase_qty',
        'pricing.view', 'pricing.set',
        'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
        'operation_log.view',
        'async_io.import', 'async_io.export',
        'store_monitor.view', 'store_monitor.view_all', 'store_monitor.assign',
    ],
    产品开发: [
        'dashboard.view', 'dashboard.kpi_products',
        'products.view',
        'product_dev.view', 'product_dev.create', 'product_dev.edit',
        'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
        'store_monitor.view', 'store_monitor.view_all',
    ],
    陪跑: [
        'dashboard.view', 'dashboard.kpi_products',
        'products.view',
        'pricing.view', 'pricing.set', 'pricing.sync_oms',
        'inventory_query.view',
    ],
    陪跑1: [
        'dashboard.view', 'dashboard.kpi_products',
        'products.view',
        'pricing.view', 'pricing.set', 'pricing.sync_oms',
        'inventory_query.view',
        'store_monitor.view',
    ],
    陪跑2: [
        'dashboard.view', 'dashboard.kpi_products',
        'products.view',
        'pricing.view', 'pricing.set', 'pricing.sync_oms',
        'inventory_query.view',
        'store_monitor.view',
    ],
    仓库: [
        'dashboard.view', 'dashboard.kpi_inventory', 'dashboard.kpi_products', 'dashboard.kpi_sync',
        'dashboard.trends_logistics', 'dashboard.pipeline_overseas',
        'products.view', 'products.print_label',
        'logistics_wh.view', 'logistics_wh.receive', 'logistics_wh.manage',
        'create_inbound.view', 'create_inbound.create', 'create_inbound.label',
        'warehouse_location.view', 'warehouse_location.edit', 'warehouse_location.batch_create',
        'inbound.view', 'inbound.arrival_scan', 'inbound.receive', 'inbound.qc', 'inbound.putaway', 'inbound.confirm_diff',
        'return.view', 'return.receive', 'return.process',
        'anheng.view', 'anheng.test',
        'outbound.view', 'outbound.create', 'outbound.relabel', 'outbound.pick', 'outbound.pack', 'outbound.ship',
        'inventory_query.view', 'inventory_query.detail', 'inventory_query.adjust',
        'stocktake.view', 'stocktake.create', 'stocktake.count', 'stocktake.approve',
        'capacity.view', 'capacity.manage', 'wms_reports.view',
        'sync.view', 'sync.retry', 'operation_log.view',
    ],
};
/** 后端 roleCode → 权限模板名 */
exports.ROLE_CODE_TEMPLATE = {
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
};
/** 角色元数据（种子 / 管理页） */
exports.ROLE_DEFINITIONS = [
    { roleCode: 'admin', roleName: '系统管理员', templateKey: '系统管理员', description: '拥有全部业务权限' },
    { roleCode: 'ops_manager', roleName: '采购主管', templateKey: '采购主管', description: '采购审核、国内物流与海外入库协调' },
    { roleCode: 'purchaser', roleName: '采购', templateKey: '采购', description: '采购下单、发运与明瑞物流' },
    { roleCode: 'warehouse', roleName: '仓库', templateKey: '仓库', description: '收货、上架、出库与盘点' },
    { roleCode: 'finance', roleName: '财务', templateKey: '财务', description: '结算、充值与报表' },
    { roleCode: 'cs', roleName: '销售', templateKey: '销售', description: '线索跟进与成交' },
    { roleCode: 'sales_manager', roleName: '销售主管', templateKey: '销售主管', description: '线索分配、团队跟进与报表' },
    { roleCode: 'dev_manager', roleName: '产品开发主管', templateKey: '产品开发主管', description: '选品审核与定价' },
    { roleCode: 'viewer', roleName: '产品开发', templateKey: '产品开发', description: '选品提交' },
    { roleCode: 'coach', roleName: '陪跑', templateKey: '陪跑', description: '定价与 OMS 同步' },
    { roleCode: 'coach1', roleName: '陪跑1', templateKey: '陪跑1', description: '店铺监控 1-5' },
    { roleCode: 'coach2', roleName: '陪跑2', templateKey: '陪跑2', description: '店铺监控 6-9,0' },
];
/** 可被分配为线索归属人的销售角色 */
exports.LEAD_ASSIGNEE_ROLE_CODES = ['cs', 'sales_manager'];
/** 新建线索时强制归属当前登录人的销售角色（不含销售主管） */
exports.LEAD_SELF_ASSIGN_ROLE_CODES = ['cs'];
const PERM_LABEL_MAP = new Map(exports.PERM_GROUPS.flatMap((g) => g.perms.map((p) => [p.id, p.label])));
exports.ALL_PERM_CODES = exports.PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.id));
exports.STORE_MONITOR_ASSIGN_PERM = 'store_monitor.assign';
function permLabel(code) {
    return PERM_LABEL_MAP.get(code) || code;
}
function permModule(code) {
    return code.split('.')[0] || code;
}
/** 剔除废弃码、应用别名，仅保留 catalog 中存在的权限 */
function normalizePermCodes(codes) {
    const valid = new Set(exports.ALL_PERM_CODES);
    const out = new Set();
    for (const raw of codes) {
        if (!raw)
            continue;
        if (exports.DEPRECATED_PERM_CODES.includes(raw))
            continue;
        const alias = exports.PERM_ALIASES[raw];
        if (alias === null)
            continue;
        const resolved = alias ?? raw;
        if (valid.has(resolved))
            out.add(resolved);
    }
    return [...out];
}
function defaultPermsForRoleCode(roleCode) {
    const key = exports.ROLE_CODE_TEMPLATE[roleCode];
    if (!key)
        return [];
    return normalizePermCodes(exports.ROLE_PERM_TEMPLATES[key] || []);
}
function templatePermsForRoleName(roleName) {
    const alias = {
        客服: '销售',
        运营主管: '采购主管',
        采购员: '采购',
        访客: '产品开发',
        仓库管理员: '仓库',
    };
    const key = alias[roleName] || roleName;
    return normalizePermCodes(exports.ROLE_PERM_TEMPLATES[key] || []);
}
//# sourceMappingURL=permissions.catalog.js.map