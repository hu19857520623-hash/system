-- 办公/仓储职位分类：新增「运营」，并把 ops_manager 显示名改为「运营主管」
INSERT IGNORE INTO `sys_role` (`role_code`, `role_name`, `description`)
VALUES ('ops', '运营', '货盘定价、店铺监控与日常运营');

UPDATE `sys_role`
SET `role_name` = '运营主管', `description` = '运营协调、采购审核与物流'
WHERE `role_code` = 'ops_manager';
