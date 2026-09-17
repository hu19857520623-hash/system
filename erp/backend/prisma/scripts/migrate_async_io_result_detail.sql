-- Async import row failure details (line number + reason). Idempotent.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'async_io_job'
    AND COLUMN_NAME = 'result_detail'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `async_io_job` ADD COLUMN `result_detail` TEXT NULL AFTER `error_message`',
  'SELECT 1'
);
PREPARE async_io_result_detail_stmt FROM @sql;
EXECUTE async_io_result_detail_stmt;
DEALLOCATE PREPARE async_io_result_detail_stmt;
