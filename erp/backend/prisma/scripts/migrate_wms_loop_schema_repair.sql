-- Repair WMS loop schema. Safe to re-run.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'operation_type'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN operation_type VARCHAR(30) NULL',
  'SELECT 1');
PREPARE billing_operation_type_stmt FROM @sql;
EXECUTE billing_operation_type_stmt;
DEALLOCATE PREPARE billing_operation_type_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'idempotency_key'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN idempotency_key VARCHAR(160) NULL',
  'SELECT 1');
PREPARE billing_idempotency_key_stmt FROM @sql;
EXECUTE billing_idempotency_key_stmt;
DEALLOCATE PREPARE billing_idempotency_key_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'calc_basis'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN calc_basis JSON NULL',
  'SELECT 1');
PREPARE billing_calc_basis_stmt FROM @sql;
EXECUTE billing_calc_basis_stmt;
DEALLOCATE PREPARE billing_calc_basis_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'rule_snapshot'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN rule_snapshot JSON NULL',
  'SELECT 1');
PREPARE billing_rule_snapshot_stmt FROM @sql;
EXECUTE billing_rule_snapshot_stmt;
DEALLOCATE PREPARE billing_rule_snapshot_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'reversal_of'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN reversal_of BIGINT NULL',
  'SELECT 1');
PREPARE billing_reversal_of_stmt FROM @sql;
EXECUTE billing_reversal_of_stmt;
DEALLOCATE PREPARE billing_reversal_of_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'occurred_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN occurred_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE billing_occurred_at_stmt FROM @sql;
EXECUTE billing_occurred_at_stmt;
DEALLOCATE PREPARE billing_occurred_at_stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND INDEX_NAME = 'billing_charge_idempotency_key_key'
);
SET @sql_idx := IF(@idx_exists = 0,
  'ALTER TABLE billing_charge ADD UNIQUE KEY billing_charge_idempotency_key_key (idempotency_key)',
  'SELECT 1');
PREPARE billing_idempotency_idx_stmt FROM @sql_idx;
EXECUTE billing_idempotency_idx_stmt;
DEALLOCATE PREPARE billing_idempotency_idx_stmt;

CREATE TABLE IF NOT EXISTS `stocktake_plan` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `stocktake_no` VARCHAR(30) NOT NULL,
  `warehouse_code` VARCHAR(30) NOT NULL,
  `mode` VARCHAR(20) NOT NULL DEFAULT 'location',
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `blind_count` TINYINT(1) NOT NULL DEFAULT 1,
  `scope_json` JSON NULL,
  `remark` VARCHAR(500) NULL,
  `created_by` BIGINT NULL,
  `approved_by` BIGINT NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `stocktake_no_key` (`stocktake_no`),
  KEY `idx_stocktake_plan_wh_status` (`warehouse_code`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stocktake_line` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `plan_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `sku` VARCHAR(30) NOT NULL,
  `location_id` BIGINT NOT NULL,
  `location_code` VARCHAR(30) NOT NULL,
  `book_qty` INT NOT NULL,
  `first_qty` INT NULL,
  `second_qty` INT NULL,
  `final_qty` INT NULL,
  `variance_qty` INT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `first_counted_by` BIGINT NULL,
  `second_counted_by` BIGINT NULL,
  `counted_at` DATETIME(3) NULL,
  `recounted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stocktake_line_scope` (`plan_id`, `product_id`, `location_id`),
  KEY `idx_stocktake_line_status` (`plan_id`, `status`),
  CONSTRAINT `fk_stocktake_line_plan` FOREIGN KEY (`plan_id`) REFERENCES `stocktake_plan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `capacity_alert` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `warehouse_code` VARCHAR(30) NOT NULL,
  `location_id` BIGINT NULL,
  `location_code` VARCHAR(30) NULL,
  `alert_type` VARCHAR(30) NOT NULL,
  `alert_level` VARCHAR(20) NOT NULL,
  `usage_rate` DECIMAL(8,4) NULL,
  `message` VARCHAR(500) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_capacity_alert_wh_status` (`warehouse_code`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
