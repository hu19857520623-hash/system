SET @warehouse_required_files_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse' AND COLUMN_NAME = 'required_outbound_files'
);
SET @warehouse_required_files_sql = IF(
  @warehouse_required_files_exists = 0,
  'ALTER TABLE `warehouse` ADD COLUMN `required_outbound_files` TEXT NULL AFTER `contact_phone`',
  'SELECT 1'
);
PREPARE warehouse_required_files_stmt FROM @warehouse_required_files_sql;
EXECUTE warehouse_required_files_stmt;
DEALLOCATE PREPARE warehouse_required_files_stmt;

SET @outbound_problem_type_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'problem_type'
);
SET @outbound_problem_type_sql = IF(
  @outbound_problem_type_exists = 0,
  'ALTER TABLE `outbound_order` ADD COLUMN `problem_type` VARCHAR(30) NULL AFTER `is_problem`',
  'SELECT 1'
);
PREPARE outbound_problem_type_stmt FROM @outbound_problem_type_sql;
EXECUTE outbound_problem_type_stmt;
DEALLOCATE PREPARE outbound_problem_type_stmt;

SET @outbound_exception_type_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'exception_type'
);
SET @outbound_exception_type_sql = IF(
  @outbound_exception_type_exists = 0,
  'ALTER TABLE `outbound_order` ADD COLUMN `exception_type` VARCHAR(30) NULL AFTER `problem_type`',
  'SELECT 1'
);
PREPARE outbound_exception_type_stmt FROM @outbound_exception_type_sql;
EXECUTE outbound_exception_type_stmt;
DEALLOCATE PREPARE outbound_exception_type_stmt;
