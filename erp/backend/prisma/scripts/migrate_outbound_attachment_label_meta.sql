-- Cropped outbound label metadata (idempotent; safe to re-run).

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'sku');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN sku VARCHAR(30) NULL AFTER file_path', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'platform_barcode');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN platform_barcode VARCHAR(100) NULL AFTER sku', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'unit_index');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN unit_index INT NULL AFTER platform_barcode', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'source_page');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN source_page INT NULL AFTER unit_index', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'source_row');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN source_row INT NULL AFTER source_page', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'source_column');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN source_column INT NULL AFTER source_row', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'label_role');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN label_role VARCHAR(30) NULL AFTER source_column', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND COLUMN_NAME = 'content_hash');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_attachment ADD COLUMN content_hash CHAR(64) NULL AFTER label_role', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_attachment' AND INDEX_NAME = 'idx_ob_att_label');
SET @sql := IF(@index_exists = 0, 'CREATE INDEX idx_ob_att_label ON outbound_attachment (outbound_id, file_type, sku, unit_index)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
