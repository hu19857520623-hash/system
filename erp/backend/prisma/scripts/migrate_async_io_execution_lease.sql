-- Export execution fencing and heartbeat lease. Additive and idempotent.
SET @async_lease_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'async_io_job' AND COLUMN_NAME = 'execution_token');
SET @async_lease_sql = IF(@async_lease_exists = 0, 'ALTER TABLE `async_io_job` ADD COLUMN `execution_token` VARCHAR(36) NULL', 'SELECT 1');
PREPARE async_lease_stmt FROM @async_lease_sql;
EXECUTE async_lease_stmt;
DEALLOCATE PREPARE async_lease_stmt;
SET @async_lease_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'async_io_job' AND COLUMN_NAME = 'lease_until');
SET @async_lease_sql = IF(@async_lease_exists = 0, 'ALTER TABLE `async_io_job` ADD COLUMN `lease_until` DATETIME(3) NULL', 'SELECT 1');
PREPARE async_lease_stmt FROM @async_lease_sql;
EXECUTE async_lease_stmt;
DEALLOCATE PREPARE async_lease_stmt;
