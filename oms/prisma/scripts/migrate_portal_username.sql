-- OMS portal login: loginEmail -> username (6-50 chars, unique).
-- Idempotent. Existing hashes and mustChangePassword are preserved.

SET @has_username := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND COLUMN_NAME = 'username'
);
SET @sql := IF(
  @has_username = 0,
  'ALTER TABLE `oms_PortalUser` ADD COLUMN `username` VARCHAR(50) NULL AFTER `customerId`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_login_email := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND COLUMN_NAME = 'loginEmail'
);

SET @sql := IF(
  @has_login_email > 0,
  'UPDATE `oms_PortalUser`
   SET `username` = CASE
     WHEN LOWER(TRIM(`loginEmail`)) IN (''admin@oms.local'', ''admin@example.com'') THEN ''omsadmin''
     WHEN CHAR_LENGTH(SUBSTRING_INDEX(`loginEmail`, ''@'', 1)) >= 6
       AND SUBSTRING_INDEX(`loginEmail`, ''@'', 1) REGEXP ''^[A-Za-z0-9._-]+$''
     THEN LOWER(SUBSTRING_INDEX(`loginEmail`, ''@'', 1))
     ELSE LOWER(CONCAT(''user'', LEFT(REPLACE(`id`, ''-'', ''''), 8)))
   END
   WHERE `username` IS NULL OR TRIM(`username`) = ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `oms_PortalUser` u
JOIN (
  SELECT `username`, MIN(`id`) AS `keep_id`
  FROM `oms_PortalUser`
  WHERE `username` IS NOT NULL AND TRIM(`username`) <> ''
  GROUP BY `username`
  HAVING COUNT(*) > 1
) d ON u.`username` = d.`username` AND u.`id` <> d.`keep_id`
SET u.`username` = LOWER(CONCAT(LEFT(u.`username`, 40), LEFT(REPLACE(u.`id`, '-', ''), 6)));

UPDATE `oms_PortalUser`
SET `username` = LOWER(CONCAT('user', LEFT(REPLACE(`id`, '-', ''), 8)))
WHERE `username` IS NULL OR TRIM(`username`) = '';

ALTER TABLE `oms_PortalUser`
  MODIFY COLUMN `username` VARCHAR(50) NOT NULL;

SET @idx_login := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND INDEX_NAME = 'oms_PortalUser_loginEmail_key'
);
SET @sql := IF(
  @idx_login > 0,
  'ALTER TABLE `oms_PortalUser` DROP INDEX `oms_PortalUser_loginEmail_key`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_username := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND INDEX_NAME = 'oms_PortalUser_username_key'
);
SET @sql := IF(
  @idx_username = 0,
  'CREATE UNIQUE INDEX `oms_PortalUser_username_key` ON `oms_PortalUser` (`username`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_login_email := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND COLUMN_NAME = 'loginEmail'
);
SET @sql := IF(
  @has_login_email > 0,
  'ALTER TABLE `oms_PortalUser` DROP COLUMN `loginEmail`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
