-- Unified ERP/OMS onboarding migration for the shared takealot_erp database.
-- Idempotent: safe to re-run. Existing login emails are normalized in place;
-- the UPDATE intentionally fails instead of silently merging duplicate identities.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_CustomerAccount'
    AND COLUMN_NAME = 'companyName'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `oms_CustomerAccount` ADD COLUMN `companyName` VARCHAR(200) NULL AFTER `name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_SystemMessage'
    AND COLUMN_NAME = 'customerId'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `oms_SystemMessage` ADD COLUMN `customerId` VARCHAR(50) NULL AFTER `id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_SystemMessage'
    AND INDEX_NAME = 'oms_SystemMessage_customerId_idx'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX `oms_SystemMessage_customerId_idx` ON `oms_SystemMessage` (`customerId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_SystemMessage'
    AND CONSTRAINT_NAME = 'oms_SystemMessage_customerId_fkey'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `oms_SystemMessage` ADD CONSTRAINT `oms_SystemMessage_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_CustomerAccount'
    AND COLUMN_NAME = 'contactPhone'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `oms_CustomerAccount` ADD COLUMN `contactPhone` VARCHAR(30) NULL AFTER `contact`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Preserve a useful company display name for legacy OMS customers.
UPDATE `oms_CustomerAccount`
SET `companyName` = `name`
WHERE `companyName` IS NULL OR TRIM(`companyName`) = '';

CREATE TABLE IF NOT EXISTS `oms_BillingAccount` (
  `id` VARCHAR(50) NOT NULL,
  `customerId` VARCHAR(50) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `contact` VARCHAR(100) NOT NULL,
  `warehouse` VARCHAR(100) NOT NULL,
  `creditBalance` DOUBLE NOT NULL DEFAULT 0,
  `monthlySpent` DOUBLE NOT NULL DEFAULT 0,
  `pendingBill` DOUBLE NOT NULL DEFAULT 0,
  `budgetUsed` DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `oms_BillingAccount_customerId_key` (`customerId`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_BillingAccount'
    AND INDEX_NAME = 'oms_BillingAccount_customerId_key'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX `oms_BillingAccount_customerId_key` ON `oms_BillingAccount` (`customerId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `oms_PortalUser` (
  `id` VARCHAR(50) NOT NULL,
  `customerId` VARCHAR(50) NULL,
  `loginEmail` VARCHAR(200) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(30) NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `mustChangePassword` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` VARCHAR(40) NOT NULL,
  `updatedAt` VARCHAR(40) NOT NULL,
  `lastLoginAt` VARCHAR(40) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `oms_PortalUser_customerId_key` (`customerId`),
  UNIQUE INDEX `oms_PortalUser_loginEmail_key` (`loginEmail`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A NULL customerId is reserved for system administrators.
ALTER TABLE `oms_PortalUser`
  MODIFY COLUMN `customerId` VARCHAR(50) NULL;

-- Application writes are normalized too; this backfills pre-existing identities.
-- Skipped after migrate_portal_username.sql replaced loginEmail with username.
SET @has_login_email := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND COLUMN_NAME = 'loginEmail'
);
SET @sql := IF(
  @has_login_email > 0,
  'UPDATE `oms_PortalUser` SET `loginEmail` = LOWER(TRIM(`loginEmail`)) WHERE `loginEmail` <> LOWER(TRIM(`loginEmail`))',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND INDEX_NAME = 'oms_PortalUser_customerId_key'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX `oms_PortalUser_customerId_key` ON `oms_PortalUser` (`customerId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND INDEX_NAME = 'oms_PortalUser_loginEmail_key'
);
SET @has_login_email := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND COLUMN_NAME = 'loginEmail'
);
SET @sql := IF(
  @idx_exists = 0 AND @has_login_email > 0,
  'CREATE UNIQUE INDEX `oms_PortalUser_loginEmail_key` ON `oms_PortalUser` (`loginEmail`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_BillingAccount'
    AND CONSTRAINT_NAME = 'oms_BillingAccount_customerId_fkey'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `oms_BillingAccount` ADD CONSTRAINT `oms_BillingAccount_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_PortalUser'
    AND CONSTRAINT_NAME = 'oms_PortalUser_customerId_fkey'
);
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `oms_PortalUser` ADD CONSTRAINT `oms_PortalUser_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
