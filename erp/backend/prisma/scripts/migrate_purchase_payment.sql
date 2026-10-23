CREATE TABLE IF NOT EXISTS `purchase_payment` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `po_id` BIGINT NOT NULL,
  `payment_type` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(14, 2) NOT NULL,
  `remark` VARCHAR(500) NULL,
  `paid_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `paid_by` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_po_payment_po` (`po_id`)
);
