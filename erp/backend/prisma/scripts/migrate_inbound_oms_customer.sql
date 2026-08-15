-- OMS 预约入库关联客户编码
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inbound_order'
    AND COLUMN_NAME = 'oms_customer_code'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE inbound_order ADD COLUMN oms_customer_code VARCHAR(30) NULL COMMENT ''OMS客户编码'' AFTER remark',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inbound_order'
    AND INDEX_NAME = 'idx_inbound_oms_customer'
);
SET @sql_idx := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_inbound_oms_customer ON inbound_order (oms_customer_code)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql_idx;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
