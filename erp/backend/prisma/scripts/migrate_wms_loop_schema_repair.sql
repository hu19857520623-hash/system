-- 补齐仓储闭环表结构：生产曾只部署代码、未执行 migrate_wms_management_loop.sql，
-- 导致 billing_charge 缺列、stocktake/capacity 表不存在，作业报表/盘点接口 500。
-- 可重复执行。

-- ── billing_charge 扩展列（逐列添加，避免 AFTER 依赖失败导致整段中止）──
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'operation_type'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN operation_type VARCHAR(30) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'idempotency_key'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN idempotency_key VARCHAR(160) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'calc_basis'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN calc_basis JSON NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'rule_snapshot'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN rule_snapshot JSON NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'reversal_of'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN reversal_of BIGINT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND COLUMN_NAME = 'occurred_at'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE billing_charge ADD COLUMN occurred_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'billing_charge' AND INDEX_NAME = 'billing_charge_idempotency_key_key'
);
SET @sql_idx := IF(@idx_exists = 0,
  'ALTER TABLE billing_charge ADD UNIQUE KEY billing_charge_idempotency_key_key (idempotency_key)',
  'SELECT 1');
PREPARE stmt FROM @sql_idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

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
  SELECT 'wms_reports.view'
) perms;

INSERT IGNORE INTO `sys_role_permission` (`role_code`, `perm_code`) VALUES
  ('finance', 'wms_reports.view');
