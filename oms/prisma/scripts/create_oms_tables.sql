-- OMS tables inside takealot_erp (prefix oms_). Safe to re-run: IF NOT EXISTS.
-- Do NOT use `prisma db push` against this shared database from OMS.

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
    UNIQUE INDEX `oms_CustomerAccount_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_CustomerAccount'
    AND COLUMN_NAME = 'companyName'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `oms_CustomerAccount` ADD COLUMN `companyName` VARCHAR(200) NULL AFTER `name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_CustomerAccount'
    AND COLUMN_NAME = 'contactPhone'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `oms_CustomerAccount` ADD COLUMN `contactPhone` VARCHAR(30) NULL AFTER `contact`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `oms_PortalUser` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `username` VARCHAR(50) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(30) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` VARCHAR(40) NOT NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    `lastLoginAt` VARCHAR(40) NULL,
    UNIQUE INDEX `oms_PortalUser_customerId_key`(`customerId`),
    UNIQUE INDEX `oms_PortalUser_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Existing customer-bound portal tables must allow customer-less sys_admin rows.
ALTER TABLE `oms_PortalUser`
  MODIFY COLUMN `customerId` VARCHAR(50) NULL;

CREATE TABLE IF NOT EXISTS `oms_BillingAccount` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `contact` VARCHAR(100) NOT NULL,
    `warehouse` VARCHAR(100) NOT NULL,
    `creditBalance` DOUBLE NOT NULL,
    `monthlySpent` DOUBLE NOT NULL,
    `pendingBill` DOUBLE NOT NULL,
    `budgetUsed` DOUBLE NOT NULL,
    UNIQUE INDEX `oms_BillingAccount_customerId_key`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_FeeRecord` (
    `id` VARCHAR(50) NOT NULL,
    `date` VARCHAR(40) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `refNo` VARCHAR(100) NOT NULL,
    `desc` TEXT NOT NULL,
    `amount` DOUBLE NOT NULL,
    `method` VARCHAR(50) NULL,
    `customerCode` VARCHAR(50) NULL,
    `rechargeNo` VARCHAR(50) NULL,
    `paymentMethodId` VARCHAR(50) NULL,
    `paymentMethodTitle` VARCHAR(100) NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_StoreAccount` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `platform` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `storeCode` VARCHAR(50) NOT NULL,
    `sellerId` VARCHAR(100) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `orderSync` BOOLEAN NOT NULL,
    `inventorySync` BOOLEAN NOT NULL,
    `autoPullInterval` VARCHAR(30) NOT NULL,
    `lastSyncAt` VARCHAR(40) NOT NULL,
    `todayOrders` INTEGER NOT NULL,
    `syncError` TEXT NULL,
    `apiKeyMasked` VARCHAR(200) NOT NULL,
    `webhookUrl` TEXT NOT NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_Product` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `internalSku` VARCHAR(50) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `spec` VARCHAR(200) NOT NULL,
    `image` TEXT NOT NULL,
    `price` DOUBLE NOT NULL,
    `cost` DOUBLE NOT NULL,
    `availableQty` INTEGER NOT NULL,
    `lockedQty` INTEGER NOT NULL,
    `customCode` VARCHAR(100) NULL,
    `category` VARCHAR(100) NOT NULL,
    `categoryPath` VARCHAR(300) NOT NULL,
    `weight` VARCHAR(50) NOT NULL,
    `weightKg` DOUBLE NOT NULL,
    `lengthCm` DOUBLE NOT NULL,
    `widthCm` DOUBLE NOT NULL,
    `heightCm` DOUBLE NOT NULL,
    `inCatalog` BOOLEAN NOT NULL,
    `productStatus` VARCHAR(30) NOT NULL,
    `hasBattery` BOOLEAN NOT NULL,
    `certUploaded` BOOLEAN NOT NULL,
    `hasBoxSpec` BOOLEAN NOT NULL,
    `outerBoxBarcode` VARCHAR(100) NULL,
    `declaredNameEn` VARCHAR(300) NOT NULL,
    `declaredNameCn` VARCHAR(300) NOT NULL,
    `declaredValue` DOUBLE NOT NULL,
    `unit` VARCHAR(20) NOT NULL,
    INDEX `oms_Product_internalSku_idx`(`internalSku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_InventoryItem` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `sku` VARCHAR(50) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `image` TEXT NOT NULL,
    `available` INTEGER NOT NULL,
    `locked` INTEGER NOT NULL,
    `inTransit` INTEGER NOT NULL,
    `safetyStock` INTEGER NOT NULL,
    `spec` VARCHAR(200) NOT NULL,
    `customCode` VARCHAR(100) NULL,
    `ean` VARCHAR(50) NULL,
    `warehouse` VARCHAR(100) NOT NULL,
    `pendingShelving` INTEGER NOT NULL,
    `pendingOutbound` INTEGER NOT NULL,
    `defective` INTEGER NOT NULL,
    `shipped` INTEGER NOT NULL,
    `warningQty` INTEGER NOT NULL,
    `price` DOUBLE NOT NULL,
    `declaredNameEn` VARCHAR(300) NULL,
    `categoryPath` VARCHAR(300) NULL,
    `stockSource` VARCHAR(30) NOT NULL,
    INDEX `oms_InventoryItem_sku_idx`(`sku`),
    INDEX `oms_InventoryItem_warehouse_idx`(`warehouse`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_Order` (
    `id` VARCHAR(50) NOT NULL,
    `orderNo` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `platform` VARCHAR(50) NOT NULL,
    `store` VARCHAR(200) NOT NULL,
    `country` VARCHAR(100) NOT NULL,
    `countryCode` VARCHAR(10) NOT NULL,
    `skuCount` INTEGER NOT NULL,
    `warehouse` VARCHAR(100) NOT NULL,
    `logistics` VARCHAR(100) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `exception` VARCHAR(100) NULL,
    `exceptionReason` TEXT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    `recipient` VARCHAR(200) NOT NULL,
    `address` TEXT NOT NULL,
    `items` TEXT NOT NULL,
    `tracking` TEXT NOT NULL,
    `fees` TEXT NOT NULL,
    `logs` TEXT NOT NULL,
    UNIQUE INDEX `oms_Order_orderNo_key`(`orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_InboundOrder` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `inboundNo` VARCHAR(50) NOT NULL,
    `source` VARCHAR(50) NOT NULL,
    `inboundType` VARCHAR(50) NOT NULL,
    `deliveryMethod` VARCHAR(50) NOT NULL,
    `stockSource` VARCHAR(30) NOT NULL,
    `boxCount` INTEGER NOT NULL,
    `skuCount` INTEGER NOT NULL,
    `totalQty` INTEGER NOT NULL,
    `receivedQty` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    `eta` VARCHAR(40) NULL,
    `warehouse` VARCHAR(100) NOT NULL,
    `referenceNo` VARCHAR(100) NULL,
    `trackingNo` VARCHAR(100) NULL,
    `contact` VARCHAR(100) NULL,
    `contactPhone` VARCHAR(50) NULL,
    `skuHint` VARCHAR(200) NULL,
    `remark` TEXT NULL,
    `exceptionCode` VARCHAR(50) NULL,
    `exceptionReason` TEXT NULL,
    `lineItems` TEXT NULL,
    `attachments` TEXT NULL,
    UNIQUE INDEX `oms_InboundOrder_inboundNo_key`(`inboundNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_ReturnOrder` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `returnNo` VARCHAR(50) NOT NULL,
    `orderNo` VARCHAR(50) NOT NULL,
    `referenceNo` VARCHAR(100) NULL,
    `trackingNo` VARCHAR(100) NULL,
    `sellerStoreName` VARCHAR(200) NULL,
    `sellerTaxNo` VARCHAR(100) NULL,
    `returnWarehouse` VARCHAR(20) NULL,
    `expectedArrivalAt` VARCHAR(40) NULL,
    `returnReason` VARCHAR(200) NOT NULL,
    `returnDescription` TEXT NULL,
    `requestedProcess` VARCHAR(30) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `processResult` VARCHAR(30) NULL,
    `processRemark` TEXT NULL,
    `receivedAt` VARCHAR(40) NULL,
    `processedAt` VARCHAR(40) NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    `lineItems` TEXT NULL,
    `remark` TEXT NULL,
    `attachments` TEXT NULL,
    UNIQUE INDEX `oms_ReturnOrder_returnNo_key`(`returnNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_OutboundOrder` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `outboundNo` VARCHAR(50) NOT NULL,
    `source` VARCHAR(50) NOT NULL,
    `stockSource` VARCHAR(30) NOT NULL,
    `refNo` VARCHAR(100) NULL,
    `orderNo` VARCHAR(50) NULL,
    `type` VARCHAR(50) NOT NULL,
    `warehouse` VARCHAR(100) NOT NULL,
    `items` INTEGER NOT NULL,
    `totalQty` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `destination` VARCHAR(200) NOT NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    `trackingNo` VARCHAR(100) NULL,
    `shippingMethod` VARCHAR(50) NULL,
    `preDeductFees` TEXT NULL,
    `destRegion` VARCHAR(50) NULL,
    `priceTemplateId` VARCHAR(50) NULL,
    `priceTemplateName` VARCHAR(200) NULL,
    `preDeductTotal` DOUBLE NULL,
    `preDeductVolumeM3` DOUBLE NULL,
    `preDeductWeightKg` DOUBLE NULL,
    `preDeductSnapshot` TEXT NULL,
    `measureSnapshot` TEXT NULL,
    `actualFeesSnapshot` TEXT NULL,
    `recipient` TEXT NULL,
    `actualFeesTotal` DOUBLE NULL,
    `settlementDelta` DOUBLE NULL,
    `settlementStatus` VARCHAR(30) NULL,
    `measuredVolumeM3` DOUBLE NULL,
    `measuredWeightKg` DOUBLE NULL,
    `scheduledDeliveryDate` VARCHAR(40) NULL,
    `sellerStoreName` VARCHAR(200) NULL,
    `takealotDestWarehouse` VARCHAR(20) NULL,
    `takealotSellerId` VARCHAR(30) NULL,
    `takealotBookingRef` VARCHAR(50) NULL,
    `shipmentDueDate` VARCHAR(40) NULL,
    `remark` TEXT NULL,
    `exceptionCode` VARCHAR(50) NULL,
    `exceptionReason` TEXT NULL,
    `lineItems` TEXT NULL,
    `attachments` TEXT NULL,
    UNIQUE INDEX `oms_OutboundOrder_outboundNo_key`(`outboundNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_CodeMapping` (
    `id` VARCHAR(50) NOT NULL,
    `internalSku` VARCHAR(50) NOT NULL,
    `productName` VARCHAR(300) NOT NULL,
    `codeType` VARCHAR(50) NOT NULL,
    `codeValue` VARCHAR(100) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `version` INTEGER NOT NULL,
    `hasInventory` BOOLEAN NOT NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    `platformMappingId` VARCHAR(50) NULL,
    INDEX `oms_CodeMapping_internalSku_idx`(`internalSku`),
    INDEX `oms_CodeMapping_codeValue_idx`(`codeValue`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_PlatformSkuMapping` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `sellerId` VARCHAR(100) NULL,
    `platform` VARCHAR(50) NOT NULL,
    `storeId` VARCHAR(50) NOT NULL,
    `storeName` VARCHAR(200) NOT NULL,
    `platformSkuId` VARCHAR(100) NULL,
    `platformBarcode` VARCHAR(100) NOT NULL,
    `platformTitle` VARCHAR(300) NOT NULL,
    `platformListingId` VARCHAR(100) NULL,
    `lines` TEXT NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `stockSource` VARCHAR(30) NOT NULL,
    `syncSource` VARCHAR(50) NOT NULL,
    `version` INTEGER NOT NULL,
    `hasInventory` BOOLEAN NOT NULL,
    `lastSyncAt` VARCHAR(40) NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_LogisticsRecord` (
    `id` VARCHAR(50) NOT NULL,
    `refNo` VARCHAR(100) NOT NULL,
    `outboundNo` VARCHAR(50) NOT NULL,
    `carrier` VARCHAR(100) NOT NULL,
    `trackingNo` VARCHAR(100) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `destination` VARCHAR(200) NOT NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    `podStatus` VARCHAR(30) NOT NULL,
    `podCode` VARCHAR(80) NULL,
    `podFileName` VARCHAR(255) NULL,
    `podFileUrl` TEXT NULL,
    `podUploadedAt` VARCHAR(40) NULL,
    `exceptionCode` VARCHAR(50) NULL,
    `exceptionReason` TEXT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_QcReport` (
    `id` VARCHAR(50) NOT NULL,
    `inboundNo` VARCHAR(50) NOT NULL,
    `sku` VARCHAR(50) NOT NULL,
    `productName` VARCHAR(300) NOT NULL,
    `sampleQty` INTEGER NOT NULL,
    `passQty` INTEGER NOT NULL,
    `failQty` INTEGER NOT NULL,
    `result` VARCHAR(30) NOT NULL,
    `reportDate` VARCHAR(40) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_SystemMessage` (
    `id` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `read` BOOLEAN NOT NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    INDEX `oms_SystemMessage_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_SystemMessage'
    AND COLUMN_NAME = 'customerId'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `oms_SystemMessage` ADD COLUMN `customerId` VARCHAR(50) NULL AFTER `id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'oms_SystemMessage'
    AND INDEX_NAME = 'oms_SystemMessage_customerId_idx'
);
SET @sql := IF(
  @index_exists = 0,
  'CREATE INDEX `oms_SystemMessage_customerId_idx` ON `oms_SystemMessage` (`customerId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `oms_WebhookEvent` (
    `eventId` VARCHAR(80) NOT NULL,
    `eventType` VARCHAR(50) NOT NULL,
    `customerCode` VARCHAR(50) NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    PRIMARY KEY (`eventId`),
    INDEX `oms_WebhookEvent_status_receivedAt_idx` (`status`, `receivedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_Announcement` (
    `id` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `date` VARCHAR(40) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_PriceTemplate` (
    `id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `regionCode` VARCHAR(50) NOT NULL DEFAULT 'jhb',
    `warehouseId` VARCHAR(50) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `handling` TEXT NOT NULL,
    `shippingByRegion` TEXT NOT NULL,
    `pickupByRegion` TEXT NOT NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_StorageRentTemplate` (
    `id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `warehouseId` VARCHAR(50) NOT NULL,
    `status` VARCHAR(30) NOT NULL,
    `billingUnit` VARCHAR(30) NOT NULL,
    `pricePerCbmPerDay` DOUBLE NOT NULL,
    `pricePerPiecePerDay` DOUBLE NOT NULL,
    `minChargePerDay` DOUBLE NOT NULL,
    `freeStorageDays` INTEGER NOT NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_RegionDispatchRule` (
    `id` VARCHAR(50) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `shippingMethod` VARCHAR(50) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `remark` TEXT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_CatalogPurchase` (
    `id` VARCHAR(50) NOT NULL,
    `purchaseNo` VARCHAR(50) NOT NULL,
    `customerId` VARCHAR(50) NOT NULL,
    `sku` VARCHAR(50) NOT NULL,
    `productName` VARCHAR(300) NOT NULL,
    `qty` INTEGER NOT NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    INDEX `oms_CatalogPurchase_customerId_idx`(`customerId`),
    INDEX `oms_CatalogPurchase_sku_idx`(`sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `oms_PaymentMethod` (
    `id` VARCHAR(50) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `bankName` VARCHAR(100) NULL,
    `accountName` VARCHAR(100) NULL,
    `accountNumber` VARCHAR(100) NULL,
    `branch` VARCHAR(200) NULL,
    `swiftCode` VARCHAR(50) NULL,
    `qrCodeUrl` TEXT NULL,
    `accountId` VARCHAR(50) NULL,
    `customText` VARCHAR(2000) NOT NULL DEFAULT '',
    `updatedAt` VARCHAR(40) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys (ignore if already exist)
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_BillingAccount_customerId_fkey'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE `oms_BillingAccount` ADD CONSTRAINT `oms_BillingAccount_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_PortalUser_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_PortalUser` ADD CONSTRAINT `oms_PortalUser_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_StoreAccount_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_StoreAccount` ADD CONSTRAINT `oms_StoreAccount_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_Product_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_Product` ADD CONSTRAINT `oms_Product_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_InventoryItem_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_InventoryItem` ADD CONSTRAINT `oms_InventoryItem_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_Order_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_Order` ADD CONSTRAINT `oms_Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_InboundOrder_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_InboundOrder` ADD CONSTRAINT `oms_InboundOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_ReturnOrder_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_ReturnOrder` ADD CONSTRAINT `oms_ReturnOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_OutboundOrder_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_OutboundOrder` ADD CONSTRAINT `oms_OutboundOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_PlatformSkuMapping_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_PlatformSkuMapping` ADD CONSTRAINT `oms_PlatformSkuMapping_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'oms_SystemMessage_customerId_fkey');
SET @sql := IF(@fk = 0, 'ALTER TABLE `oms_SystemMessage` ADD CONSTRAINT `oms_SystemMessage_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `oms_CustomerAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
