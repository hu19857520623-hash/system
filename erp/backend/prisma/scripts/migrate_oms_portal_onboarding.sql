-- Unified ERP/OMS onboarding. Safe to re-run against the shared MySQL database.

-- The OMS application owns this model. ERP creates the compatible table only
-- when a shared database is being initialized before OMS.
CREATE TABLE IF NOT EXISTS `oms_CustomerAccount` (
  `id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `companyName` VARCHAR(200) NULL,
  `code` VARCHAR(50) NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `contact` VARCHAR(100) NOT NULL,
  `contactPhone` VARCHAR(30) NULL,
  `email` VARCHAR(200) NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `permissions` TEXT NOT NULL,
  `warehouse` VARCHAR(100) NOT NULL,
  `createdAt` VARCHAR(40) NOT NULL,
  `lastLoginAt` VARCHAR(40) NOT NULL,
  `priceTemplateId` VARCHAR(50) NULL,
  `priceTemplateByRegion` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `oms_CustomerAccount_code_key` (`code`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ERP-authoritative customer profile fields on the shared OMS account.
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
    AND TABLE_NAME = 'oms_CustomerAccount'
    AND COLUMN_NAME = 'contactPhone'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `oms_CustomerAccount` ADD COLUMN `contactPhone` VARCHAR(30) NULL AFTER `contact`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_CustomerAccount'
    AND INDEX_NAME = 'oms_CustomerAccount_code_key'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX `oms_CustomerAccount_code_key` ON `oms_CustomerAccount` (`code`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- One billing row per customer. IDs must be supplied per row (the legacy
-- default value "default" prevented provisioning more than one account).
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

ALTER TABLE `oms_BillingAccount` MODIFY COLUMN `id` VARCHAR(50) NOT NULL;

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

CREATE TABLE IF NOT EXISTS `oms_PortalUser` (
  `id` VARCHAR(50) NOT NULL,
  `customerId` VARCHAR(50) NOT NULL,
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
SET @sql := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX `oms_PortalUser_loginEmail_key` ON `oms_PortalUser` (`loginEmail`)',
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
