-- PDA / 出库分配用工位。Safe to re-run.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'workstation'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `sys_user` ADD COLUMN `workstation` VARCHAR(30) NULL COMMENT ''拣货工位'' AFTER `role_code`',
  'SELECT 1');
PREPARE user_workstation_stmt FROM @sql;
EXECUTE user_workstation_stmt;
DEALLOCATE PREPARE user_workstation_stmt;
