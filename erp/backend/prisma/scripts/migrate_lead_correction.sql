-- 线索登记人，以及未成交资料更正记录。可重复执行。
SET @lead_created_by_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'created_by_id'
);
SET @lead_created_by_sql = IF(
  @lead_created_by_exists = 0,
  'ALTER TABLE `lead` ADD COLUMN `created_by_id` BIGINT NULL AFTER `assignee_id`',
  'SELECT 1'
);
PREPARE lead_created_by_stmt FROM @lead_created_by_sql;
EXECUTE lead_created_by_stmt;
DEALLOCATE PREPARE lead_created_by_stmt;

SET @lead_created_by_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND INDEX_NAME = 'idx_lead_created_by'
);
SET @lead_created_by_idx_sql = IF(
  @lead_created_by_idx = 0,
  'ALTER TABLE `lead` ADD INDEX `idx_lead_created_by` (`created_by_id`)',
  'SELECT 1'
);
PREPARE lead_created_by_idx_stmt FROM @lead_created_by_idx_sql;
EXECUTE lead_created_by_idx_stmt;
DEALLOCATE PREPARE lead_created_by_idx_stmt;

CREATE TABLE IF NOT EXISTS lead_correction (
  id BIGINT NOT NULL AUTO_INCREMENT,
  lead_id BIGINT NOT NULL,
  operator_id BIGINT NOT NULL,
  changes JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_correction_lead (lead_id),
  CONSTRAINT fk_lead_correction_lead FOREIGN KEY (lead_id) REFERENCES `lead` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
