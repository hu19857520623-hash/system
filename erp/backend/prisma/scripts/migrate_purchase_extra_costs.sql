-- 采购单附加费用（包装费、税费等），审核后计入采购货款。可重复执行。

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order' AND COLUMN_NAME = 'extra_costs'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `purchase_order` ADD COLUMN `extra_costs` JSON NULL AFTER `domestic_freight`',
  'SELECT 1');
PREPARE po_extra_costs_stmt FROM @sql;
EXECUTE po_extra_costs_stmt;
DEALLOCATE PREPARE po_extra_costs_stmt;
