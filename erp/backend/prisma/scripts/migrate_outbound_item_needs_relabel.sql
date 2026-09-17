-- Per-SKU relabel flag. Existing rows default to 1 (need relabel), matching current OMS Takealot flow.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'outbound_order_item'
    AND COLUMN_NAME = 'needs_relabel'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE outbound_order_item ADD COLUMN needs_relabel TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''是否需换标'' AFTER qty',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
