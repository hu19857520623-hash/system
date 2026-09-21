-- 发运海外仓：外箱装箱规格（创建入库单时录入）。可重复执行。

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_carton' AND COLUMN_NAME = 'length_cm'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_carton` ADD COLUMN `length_cm` DECIMAL(10,2) NULL AFTER `box_seq`',
  'SELECT 1');
PREPARE inbound_carton_length_stmt FROM @sql;
EXECUTE inbound_carton_length_stmt;
DEALLOCATE PREPARE inbound_carton_length_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_carton' AND COLUMN_NAME = 'width_cm'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_carton` ADD COLUMN `width_cm` DECIMAL(10,2) NULL AFTER `length_cm`',
  'SELECT 1');
PREPARE inbound_carton_width_stmt FROM @sql;
EXECUTE inbound_carton_width_stmt;
DEALLOCATE PREPARE inbound_carton_width_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_carton' AND COLUMN_NAME = 'height_cm'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_carton` ADD COLUMN `height_cm` DECIMAL(10,2) NULL AFTER `width_cm`',
  'SELECT 1');
PREPARE inbound_carton_height_stmt FROM @sql;
EXECUTE inbound_carton_height_stmt;
DEALLOCATE PREPARE inbound_carton_height_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_carton' AND COLUMN_NAME = 'gross_weight_kg'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_carton` ADD COLUMN `gross_weight_kg` DECIMAL(10,3) NULL AFTER `height_cm`',
  'SELECT 1');
PREPARE inbound_carton_weight_stmt FROM @sql;
EXECUTE inbound_carton_weight_stmt;
DEALLOCATE PREPARE inbound_carton_weight_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_carton' AND COLUMN_NAME = 'remark'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_carton` ADD COLUMN `remark` VARCHAR(200) NULL AFTER `gross_weight_kg`',
  'SELECT 1');
PREPARE inbound_carton_remark_stmt FROM @sql;
EXECUTE inbound_carton_remark_stmt;
DEALLOCATE PREPARE inbound_carton_remark_stmt;
