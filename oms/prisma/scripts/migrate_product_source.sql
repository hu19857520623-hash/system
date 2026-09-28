-- Persist how a product card entered OMS so imported and manually created
-- products remain distinguishable after logout/login. Idempotent and safe for
-- the shared production database.
SET @product_table := (
  SELECT TABLE_NAME FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND LOWER(TABLE_NAME) = 'oms_product'
    AND TABLE_TYPE = 'BASE TABLE'
  LIMIT 1
);
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = @product_table
    AND COLUMN_NAME = 'productSource'
);
SET @sql := IF(
  @product_table IS NOT NULL AND @col_exists = 0,
  CONCAT('ALTER TABLE `', @product_table, '` ADD COLUMN `productSource` VARCHAR(20) NULL AFTER `productStatus`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
