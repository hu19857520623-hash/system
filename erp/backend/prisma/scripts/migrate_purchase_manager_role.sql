-- 新增办公职位「采购主管」，与「采购」成对；不占用仓储端
INSERT IGNORE INTO `sys_role` (`role_code`, `role_name`, `description`)
VALUES ('purchase_manager', '采购主管', '采购分配、主管审核与国内物流协调');
