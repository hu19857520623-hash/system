-- 线索联系方式类型，以及二维码图片哈希。可重复执行。
SET @lead_contact_type_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'contact_type'
);
SET @lead_contact_type_sql = IF(
  @lead_contact_type_exists = 0,
  'ALTER TABLE `lead` ADD COLUMN `contact_type` VARCHAR(20) NULL AFTER `contact_phone`',
  'SELECT 1'
);
PREPARE lead_contact_type_stmt FROM @lead_contact_type_sql;
EXECUTE lead_contact_type_stmt;
DEALLOCATE PREPARE lead_contact_type_stmt;

SET @lead_qr_path_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'qr_image_path'
);
SET @lead_qr_path_sql = IF(
  @lead_qr_path_exists = 0,
  'ALTER TABLE `lead` ADD COLUMN `qr_image_path` VARCHAR(500) NULL AFTER `contact_type`',
  'SELECT 1'
);
PREPARE lead_qr_path_stmt FROM @lead_qr_path_sql;
EXECUTE lead_qr_path_stmt;
DEALLOCATE PREPARE lead_qr_path_stmt;

SET @lead_qr_hash_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'qr_image_hash'
);
SET @lead_qr_hash_sql = IF(
  @lead_qr_hash_exists = 0,
  'ALTER TABLE `lead` ADD COLUMN `qr_image_hash` VARCHAR(64) NULL AFTER `qr_image_path`',
  'SELECT 1'
);
PREPARE lead_qr_hash_stmt FROM @lead_qr_hash_sql;
EXECUTE lead_qr_hash_stmt;
DEALLOCATE PREPARE lead_qr_hash_stmt;

SET @lead_qr_hash_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND INDEX_NAME = 'idx_lead_qr_hash'
);
SET @lead_qr_hash_idx_sql = IF(
  @lead_qr_hash_idx = 0,
  'ALTER TABLE `lead` ADD INDEX `idx_lead_qr_hash` (`qr_image_hash`)',
  'SELECT 1'
);
PREPARE lead_qr_hash_idx_stmt FROM @lead_qr_hash_idx_sql;
EXECUTE lead_qr_hash_idx_stmt;
DEALLOCATE PREPARE lead_qr_hash_idx_stmt;
