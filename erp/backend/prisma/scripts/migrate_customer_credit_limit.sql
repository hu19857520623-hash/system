-- Credit does not change the balance or create a recharge. Existing customers remain prepaid.
-- Re-adds the credit limit column for the customer credit feature after the legacy
-- drop migration. Guarded so re-running on a database that already has the column is a no-op.
SET @has_credit_limit := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer' AND COLUMN_NAME = 'credit_limit'
);
SET @ddl := IF(
  @has_credit_limit = 0,
  'ALTER TABLE customer ADD COLUMN credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE credit_limit_stmt FROM @ddl;
EXECUTE credit_limit_stmt;
DEALLOCATE PREPARE credit_limit_stmt;
