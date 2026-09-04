-- 仓储职位拆分：原「仓库」显示为「仓库操作」，并新增入库/出库/退货/复核/仓库主管
UPDATE `sys_role`
SET `role_name` = '仓库操作', `description` = '收货、上架、出库与盘点'
WHERE `role_code` = 'warehouse';

INSERT IGNORE INTO `sys_role` (`role_code`, `role_name`, `description`) VALUES
('warehouse_manager', '仓库主管', '仓内作业管理、盘点审批与异常处理'),
('inbound_clerk', '入库员', '到仓扫描、收货清点与上架'),
('outbound_clerk', '出库员', '出库拣货、打包与发运'),
('returns_clerk', '退货员', '退件收货与处理'),
('warehouse_reviewer', '复核员', '出库复核');
