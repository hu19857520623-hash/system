-- 1P 权限迁移：移除已废弃的 WMS 推送权限
DELETE FROM sys_user_permission WHERE perm_code = 'create_inbound.push';
DELETE FROM sys_role_permission WHERE perm_code = 'create_inbound.push';
DELETE FROM sys_permission WHERE perm_code = 'create_inbound.push';
