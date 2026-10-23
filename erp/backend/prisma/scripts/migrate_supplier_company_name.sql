SET @supplier_company_name_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier' AND COLUMN_NAME = 'company_name'
);
SET @supplier_company_name_sql = IF(
  @supplier_company_name_exists = 0,
  'ALTER TABLE `supplier` ADD COLUMN `company_name` VARCHAR(200) NULL AFTER `supplier_name`',
  'SELECT 1'
);
PREPARE supplier_company_name_stmt FROM @supplier_company_name_sql;
EXECUTE supplier_company_name_stmt;
DEALLOCATE PREPARE supplier_company_name_stmt;
