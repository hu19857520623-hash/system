-- Outbound attachments include PDF/image data URLs. TEXT's 64 KiB capacity
-- cannot hold ordinary booking documents, labels and their generated crops.
-- ALTER the canonical base table, never a legacy mixed-case compatibility view.
SET @outbound_table := (
  SELECT TABLE_NAME
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND LOWER(TABLE_NAME) = 'oms_outboundorder'
    AND TABLE_TYPE = 'BASE TABLE'
  ORDER BY CASE WHEN TABLE_NAME = 'oms_outboundorder' THEN 0 ELSE 1 END
  LIMIT 1
);
SET @attachments_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = @outbound_table AND COLUMN_NAME = 'attachments'
);
SET @attachments_sql := IF(
  @attachments_type = 'longtext',
  'SELECT 1',
  CONCAT('ALTER TABLE `', REPLACE(@outbound_table, '`', '``'),
    '` MODIFY COLUMN `attachments` LONGTEXT NULL')
);
PREPARE attachments_stmt FROM @attachments_sql;
EXECUTE attachments_stmt;
DEALLOCATE PREPARE attachments_stmt;
