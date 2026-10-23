-- 收回持有开始退还客户余额，独立于库存调整权限。可重复执行。
SET NAMES utf8mb4;
INSERT INTO sys_permission (perm_code, perm_name, module)
VALUES ('inventory_query.reclaim_refund', '货盘持有 · 收回并按原购买单退款', 'inventory_query')
ON DUPLICATE KEY UPDATE perm_name = VALUES(perm_name), module = VALUES(module);

-- 只补已有财务角色配置，不覆盖其它权限。
-- 无角色配置时后端使用完整默认模板，不创建仅含四项权限的不完整模板。
-- 用户自定义权限保持原样，需由管理员明确授予新退款权限及所需查看权限。
INSERT IGNORE INTO sys_role_permission (role_code, perm_code)
SELECT 'finance', requested.perm_code FROM (
  SELECT 'pricing.view' AS perm_code UNION ALL
  SELECT 'inventory_query.view' UNION ALL
  SELECT 'inventory_query.detail' UNION ALL
  SELECT 'inventory_query.reclaim_refund'
) AS requested
WHERE EXISTS (
  SELECT 1 FROM (
    SELECT role_code FROM sys_role_permission WHERE role_code = 'finance' LIMIT 1
  ) AS configured_finance
);
