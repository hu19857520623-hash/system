-- Persist how a product card entered OMS so imported and manually created
-- products remain distinguishable after logout/login. Idempotent and safe for
-- the shared production database.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_Product'
    AND COLUMN_NAME = 'productSource'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `oms_Product` ADD COLUMN `productSource` VARCHAR(20) NULL AFTER `productStatus`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
