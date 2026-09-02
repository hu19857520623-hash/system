-- Restore inbound fee rule columns and permissions. Safe to re-run.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_fee_rule' AND COLUMN_NAME = 'measure_unit_price'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_fee_rule` ADD COLUMN `measure_unit_price` DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `qc_unit_price`',
  'SELECT 1');
PREPARE inbound_fee_measure_stmt FROM @sql;
EXECUTE inbound_fee_measure_stmt;
DEALLOCATE PREPARE inbound_fee_measure_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_fee_rule' AND COLUMN_NAME = 'label_unit_price'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_fee_rule` ADD COLUMN `label_unit_price` DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER `measure_unit_price`',
  'SELECT 1');
PREPARE inbound_fee_label_stmt FROM @sql;
EXECUTE inbound_fee_label_stmt;
DEALLOCATE PREPARE inbound_fee_label_stmt;

INSERT INTO `sys_permission` (`perm_code`, `perm_name`, `module`) VALUES
  ('inbound_fee.view', '入库计费-查看', 'inbound_fee'),
  ('inbound_fee.manage', '入库计费-配置', 'inbound_fee')
ON DUPLICATE KEY UPDATE `perm_name` = VALUES(`perm_name`), `module` = VALUES(`module`);

INSERT IGNORE INTO `sys_role_permission` (`role_code`, `perm_code`) VALUES
  ('admin', 'inbound_fee.view'),
  ('admin', 'inbound_fee.manage'),
  ('finance', 'inbound_fee.view'),
  ('finance', 'inbound_fee.manage');
