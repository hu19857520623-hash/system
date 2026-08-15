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
