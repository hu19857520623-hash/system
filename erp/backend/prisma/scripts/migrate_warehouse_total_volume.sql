-- Warehouse-level cubic capacity. Safe to re-run.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse' AND COLUMN_NAME = 'total_volume_cbm'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `warehouse` ADD COLUMN `total_volume_cbm` DECIMAL(12,4) NULL COMMENT ''仓级总库容 m3'' AFTER `required_outbound_files`',
  'SELECT 1');
PREPARE warehouse_total_volume_stmt FROM @sql;
EXECUTE warehouse_total_volume_stmt;
DEALLOCATE PREPARE warehouse_total_volume_stmt;
