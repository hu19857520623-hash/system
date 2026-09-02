-- 工作台 widget 权限 + 明瑞下单权限迁移
-- 1) 登记新权限码
INSERT INTO sys_permission (perm_code, perm_name, module) VALUES
  ('dashboard.view', '工作台 · 访问', 'dashboard'),
  ('dashboard.kpi_inventory', '工作台 · 可用库存指标', 'dashboard'),
  ('dashboard.kpi_products', '工作台 · 商品 SKU 指标', 'dashboard'),
  ('dashboard.kpi_suppliers', '工作台 · 活跃供应商指标', 'dashboard'),
  ('dashboard.kpi_leads', '工作台 · 线索总数指标', 'dashboard'),
  ('dashboard.kpi_purchase', '工作台 · 待审 PO 指标', 'dashboard'),
  ('dashboard.kpi_audit', '工作台 · 待审选品指标', 'dashboard'),
  ('dashboard.kpi_sync', '工作台 · 同步失败指标', 'dashboard'),
  ('dashboard.trends_logistics', '工作台 · 中转仓收货趋势', 'dashboard'),
  ('dashboard.pipeline_domestic', '工作台 · 国内供应链看板', 'dashboard'),
  ('dashboard.pipeline_overseas', '工作台 · 海外仓作业看板', 'dashboard'),
  ('mingrui.manage', '明瑞物流 · 下单/改单', 'mingrui')
ON DUPLICATE KEY UPDATE perm_name = VALUES(perm_name), module = VALUES(module);

-- 2) 旧码别名
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT role_code, 'mingrui.manage' FROM sys_role_permission WHERE perm_code = 'mingrui.order'
ON DUPLICATE KEY UPDATE perm_code = perm_code;
INSERT INTO sys_user_permission (user_id, perm_code)
SELECT user_id, 'mingrui.manage' FROM sys_user_permission WHERE perm_code = 'mingrui.order'
ON DUPLICATE KEY UPDATE perm_code = perm_code;

DELETE FROM sys_user_permission WHERE perm_code IN ('mingrui.order', 'pricing.freight_callback', 'create_inbound.push', 'inbound_fee.view', 'inbound_fee.manage');
DELETE FROM sys_role_permission WHERE perm_code IN ('mingrui.order', 'pricing.freight_callback', 'create_inbound.push', 'inbound_fee.view', 'inbound_fee.manage');
DELETE FROM sys_permission WHERE perm_code IN ('mingrui.order', 'pricing.freight_callback', 'create_inbound.push', 'inbound_fee.view', 'inbound_fee.manage');

-- 3) 角色默认：所有角色都能进工作台
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, 'dashboard.view' FROM sys_role r
ON DUPLICATE KEY UPDATE perm_code = perm_code;

-- 销售 / 销售主管：仅线索指标
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT role_code, 'dashboard.kpi_leads' FROM sys_role WHERE role_code IN ('cs', 'sales_manager', 'sales')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

-- 采购 / 采购主管
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, p.perm_code
FROM sys_role r
JOIN (
  SELECT 'dashboard.kpi_products' AS perm_code UNION ALL
  SELECT 'dashboard.kpi_suppliers' UNION ALL
  SELECT 'dashboard.kpi_purchase' UNION ALL
  SELECT 'dashboard.pipeline_domestic'
) p
WHERE r.role_code IN ('purchaser', 'ops_manager')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, p.perm_code
FROM sys_role r
JOIN (
  SELECT 'dashboard.kpi_inventory' AS perm_code UNION ALL
  SELECT 'dashboard.kpi_audit' UNION ALL
  SELECT 'dashboard.kpi_sync' UNION ALL
  SELECT 'dashboard.trends_logistics' UNION ALL
  SELECT 'dashboard.pipeline_overseas'
) p
WHERE r.role_code = 'ops_manager'
ON DUPLICATE KEY UPDATE perm_code = perm_code;

-- 仓库
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, p.perm_code
FROM sys_role r
JOIN (
  SELECT 'dashboard.kpi_inventory' AS perm_code UNION ALL
  SELECT 'dashboard.kpi_products' UNION ALL
  SELECT 'dashboard.kpi_sync' UNION ALL
  SELECT 'dashboard.trends_logistics' UNION ALL
  SELECT 'dashboard.pipeline_overseas'
) p
WHERE r.role_code = 'warehouse'
ON DUPLICATE KEY UPDATE perm_code = perm_code;

-- 财务
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, p.perm_code
FROM sys_role r
JOIN (
  SELECT 'dashboard.kpi_purchase' AS perm_code UNION ALL
  SELECT 'dashboard.kpi_sync' UNION ALL
  SELECT 'dashboard.pipeline_domestic'
) p
WHERE r.role_code = 'finance'
ON DUPLICATE KEY UPDATE perm_code = perm_code;

-- 产品开发 / 陪跑
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, 'dashboard.kpi_products'
FROM sys_role r
WHERE r.role_code IN ('viewer', 'dev_manager', 'coach', 'coach1', 'coach2')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, p.perm_code
FROM sys_role r
JOIN (
  SELECT 'dashboard.kpi_audit' AS perm_code UNION ALL
  SELECT 'dashboard.pipeline_domestic'
) p
WHERE r.role_code = 'dev_manager'
ON DUPLICATE KEY UPDATE perm_code = perm_code;

-- 管理员：全部工作台 widget
INSERT INTO sys_role_permission (role_code, perm_code)
SELECT r.role_code, p.perm_code
FROM sys_role r
JOIN (
  SELECT 'dashboard.kpi_inventory' AS perm_code UNION ALL
  SELECT 'dashboard.kpi_products' UNION ALL
  SELECT 'dashboard.kpi_suppliers' UNION ALL
  SELECT 'dashboard.kpi_leads' UNION ALL
  SELECT 'dashboard.kpi_purchase' UNION ALL
  SELECT 'dashboard.kpi_audit' UNION ALL
  SELECT 'dashboard.kpi_sync' UNION ALL
  SELECT 'dashboard.trends_logistics' UNION ALL
  SELECT 'dashboard.pipeline_domestic' UNION ALL
  SELECT 'dashboard.pipeline_overseas' UNION ALL
  SELECT 'mingrui.manage'
) p
WHERE r.role_code = 'admin'
ON DUPLICATE KEY UPDATE perm_code = perm_code;

-- 4) 已自定义权限的账号：按现有业务权限补工作台 widget，避免销售仍看到库存
INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.view' FROM sys_user_permission
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.kpi_leads'
FROM sys_user_permission
WHERE perm_code IN ('leads_pool.view', 'leads_follow.view', 'leads_deals.view', 'leads_reports.view')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.kpi_inventory'
FROM sys_user_permission
WHERE perm_code IN ('inventory_query.view', 'inbound.view', 'inbound.arrival_scan')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.kpi_products'
FROM sys_user_permission
WHERE perm_code IN ('products.view', 'product_dev.view', 'pricing.view')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.kpi_suppliers'
FROM sys_user_permission
WHERE perm_code = 'suppliers.view'
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.kpi_purchase'
FROM sys_user_permission
WHERE perm_code IN ('purchase.view', 'purchase.po_audit')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.kpi_audit'
FROM sys_user_permission
WHERE perm_code IN ('product_audit.view', 'product_audit.approve')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.kpi_sync'
FROM sys_user_permission
WHERE perm_code IN ('sync.view', 'sync.retry')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.trends_logistics'
FROM sys_user_permission
WHERE perm_code IN ('logistics_wh.view', 'logistics_wh.receive')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.pipeline_domestic'
FROM sys_user_permission
WHERE perm_code IN ('purchase.view', 'logistics_wh.view', 'product_audit.view')
ON DUPLICATE KEY UPDATE perm_code = perm_code;

INSERT INTO sys_user_permission (user_id, perm_code)
SELECT DISTINCT user_id, 'dashboard.pipeline_overseas'
FROM sys_user_permission
WHERE perm_code IN ('inbound.view', 'outbound.view', 'inbound.arrival_scan')
ON DUPLICATE KEY UPDATE perm_code = perm_code;
