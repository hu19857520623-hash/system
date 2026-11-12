-- Preserve legacy product_desc verbatim; A/B variants cannot be inferred from old shop types.
-- Guarded so re-running on a database that already has the columns or index is a no-op.
SET @has_service_code := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead_deal' AND COLUMN_NAME = 'service_code'
);
SET @ddl := IF(
  @has_service_code = 0,
  'ALTER TABLE lead_deal ADD COLUMN service_code VARCHAR(8) NULL, ADD COLUMN service_name VARCHAR(200) NULL',
  'SELECT 1'
);
PREPARE lead_deal_service_cols FROM @ddl;
EXECUTE lead_deal_service_cols;
DEALLOCATE PREPARE lead_deal_service_cols;

SET @has_service_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead_deal' AND INDEX_NAME = 'idx_lead_deal_service'
);
SET @ddl := IF(
  @has_service_idx = 0,
  'ALTER TABLE lead_deal ADD INDEX idx_lead_deal_service (service_code)',
  'SELECT 1'
);
PREPARE lead_deal_service_idx FROM @ddl;
EXECUTE lead_deal_service_idx;
DEALLOCATE PREPARE lead_deal_service_idx;
