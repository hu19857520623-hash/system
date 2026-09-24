-- 货盘共享状态：停止共享时保留客户已持有库存和已建出库单，仅禁止新的申购。
-- 可重复执行，便于生产发布重试。
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_pricing' AND COLUMN_NAME = 'share_status');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product_pricing ADD COLUMN share_status VARCHAR(10) NOT NULL DEFAULT ''enabled'' AFTER orderable_on_oms', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
