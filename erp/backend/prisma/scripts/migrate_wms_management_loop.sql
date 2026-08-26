SET @billing_idempotency_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'idempotency_key'
);
SET @billing_management_columns_sql = IF(
  @billing_idempotency_exists = 0,
  'ALTER TABLE `billing_charge`
    ADD COLUMN `operation_type` VARCHAR(30) NULL AFTER `billing_id`,
    ADD COLUMN `idempotency_key` VARCHAR(160) NULL AFTER `operation_type`,
    ADD COLUMN `calc_basis` JSON NULL AFTER `idempotency_key`,
    ADD COLUMN `rule_snapshot` JSON NULL AFTER `calc_basis`,
    ADD COLUMN `reversal_of` BIGINT NULL AFTER `rule_snapshot`,
    ADD COLUMN `occurred_at` DATETIME(3) NULL AFTER `reversal_of`,
    ADD UNIQUE KEY `billing_charge_idempotency_key_key` (`idempotency_key`)',
  'SELECT 1'
);
PREPARE billing_management_columns_stmt FROM @billing_management_columns_sql;
EXECUTE billing_management_columns_stmt;
DEALLOCATE PREPARE billing_management_columns_stmt;

CREATE TABLE IF NOT EXISTS `inbound_fee_rule` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `rule_name` VARCHAR(100) NOT NULL,
  `customer_id` BIGINT NULL,
  `warehouse_code` VARCHAR(30) NULL,
  `receive_unit_price` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `receive_carton_price` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `qc_unit_price` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `putaway_unit_price` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `effective_from` DATE NULL,
  `effective_to` DATE NULL,
  `created_by` BIGINT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_inbound_fee_rule_scope` (`customer_id`, `warehouse_code`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

INSERT INTO `sys_permission` (`perm_code`, `perm_name`, `module`) VALUES
  ('stocktake.view', '盘点管理-查看', 'stocktake'),
  ('stocktake.create', '盘点管理-创建', 'stocktake'),
  ('stocktake.count', '盘点管理-初盘/复盘', 'stocktake'),
  ('stocktake.approve', '盘点管理-审批调整', 'stocktake'),
  ('capacity.view', '仓库容量-查看', 'capacity'),
  ('capacity.manage', '仓库容量-刷新预警', 'capacity'),
  ('inbound_fee.view', '入库计费-查看', 'inbound_fee'),
  ('inbound_fee.manage', '入库计费-配置', 'inbound_fee'),
  ('wms_reports.view', '仓储作业报表-查看', 'wms_reports')
ON DUPLICATE KEY UPDATE `perm_name` = VALUES(`perm_name`), `module` = VALUES(`module`);

INSERT IGNORE INTO `sys_role_permission` (`role_code`, `perm_code`)
SELECT roles.role_code, perms.perm_code
FROM (
  SELECT 'admin' AS role_code UNION ALL SELECT 'warehouse'
) roles
CROSS JOIN (
  SELECT 'stocktake.view' AS perm_code UNION ALL SELECT 'stocktake.create' UNION ALL
  SELECT 'stocktake.count' UNION ALL SELECT 'stocktake.approve' UNION ALL
  SELECT 'capacity.view' UNION ALL SELECT 'capacity.manage' UNION ALL
  SELECT 'wms_reports.view' UNION ALL SELECT 'inbound_fee.view'
) perms;

INSERT IGNORE INTO `sys_role_permission` (`role_code`, `perm_code`) VALUES
  ('admin', 'inbound_fee.manage'),
  ('finance', 'inbound_fee.view'),
  ('finance', 'inbound_fee.manage'),
  ('finance', 'wms_reports.view');
