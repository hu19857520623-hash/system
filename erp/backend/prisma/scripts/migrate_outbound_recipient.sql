SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'outbound_order'
    AND COLUMN_NAME = 'recipient_json'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE outbound_order ADD COLUMN recipient_json TEXT NULL AFTER remark',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
