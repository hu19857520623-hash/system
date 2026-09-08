-- 海运账单改为关联柜号，并保存 SKU 分摊明细快照。可重复执行。

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_freight_bill' AND COLUMN_NAME = 'container_no'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `supplier_freight_bill`
    ADD COLUMN `container_no` VARCHAR(50) NULL AFTER `container_count`,
    ADD COLUMN `sku_details` JSON NULL AFTER `container_no`',
  'SELECT 1');
PREPARE sfb_container_stmt FROM @sql;
EXECUTE sfb_container_stmt;
DEALLOCATE PREPARE sfb_container_stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_freight_bill' AND INDEX_NAME = 'idx_sfb_container'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE `supplier_freight_bill` ADD INDEX `idx_sfb_container` (`container_no`)',
  'SELECT 1');
PREPARE sfb_container_idx_stmt FROM @sql;
EXECUTE sfb_container_idx_stmt;
DEALLOCATE PREPARE sfb_container_idx_stmt;
