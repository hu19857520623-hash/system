-- A preserves the existing final_price. Other tiers intentionally remain unpriced.
-- Guarded so re-running on a database that already has the columns is a no-op.

SET @has_customer_tier := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer' AND COLUMN_NAME = 'catalog_price_tier'
);
SET @ddl := IF(
  @has_customer_tier = 0,
  'ALTER TABLE customer ADD COLUMN catalog_price_tier VARCHAR(1) NOT NULL DEFAULT ''A''',
  'SELECT 1'
);
PREPARE catalog_customer_tier_stmt FROM @ddl;
EXECUTE catalog_customer_tier_stmt;
DEALLOCATE PREPARE catalog_customer_tier_stmt;

SET @has_price_b := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_pricing' AND COLUMN_NAME = 'price_b'
);
SET @ddl := IF(
  @has_price_b = 0,
  'ALTER TABLE product_pricing ADD COLUMN price_b DECIMAL(12,2) NULL, ADD COLUMN price_c DECIMAL(12,2) NULL, ADD COLUMN price_d DECIMAL(12,2) NULL',
  'SELECT 1'
);
PREPARE catalog_price_tiers_stmt FROM @ddl;
EXECUTE catalog_price_tiers_stmt;
DEALLOCATE PREPARE catalog_price_tiers_stmt;

SET @has_order_tier := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_catalog_order' AND COLUMN_NAME = 'price_tier'
);
SET @ddl := IF(
  @has_order_tier = 0,
  'ALTER TABLE oms_catalog_order ADD COLUMN price_tier VARCHAR(1) NOT NULL DEFAULT ''A''',
  'SELECT 1'
);
PREPARE catalog_order_tier_stmt FROM @ddl;
EXECUTE catalog_order_tier_stmt;
DEALLOCATE PREPARE catalog_order_tier_stmt;
