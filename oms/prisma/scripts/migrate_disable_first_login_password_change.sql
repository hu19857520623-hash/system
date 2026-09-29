-- OMS passwords are managed by administrators. Accounts may change their
-- password voluntarily, but a first login must not be blocked by this flag.
--
-- Some production databases expose Prisma's `oms_PortalUser` name as a view
-- over the canonical lower-case table. ALTER must always target the base table.
SET @portal_user_table := (
  SELECT TABLE_NAME
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND LOWER(TABLE_NAME) = 'oms_portaluser'
    AND TABLE_TYPE = 'BASE TABLE'
  ORDER BY CASE WHEN TABLE_NAME = 'oms_portaluser' THEN 0 ELSE 1 END
  LIMIT 1
);

SET @alter_sql := IF(
  @portal_user_table IS NULL,
  'SELECT 1',
  CONCAT(
    'ALTER TABLE `', REPLACE(@portal_user_table, '`', '``'),
    '` MODIFY COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT FALSE'
  )
);
PREPARE alter_stmt FROM @alter_sql;
EXECUTE alter_stmt;
DEALLOCATE PREPARE alter_stmt;

SET @update_sql := IF(
  @portal_user_table IS NULL,
  'SELECT 1',
  CONCAT(
    'UPDATE `', REPLACE(@portal_user_table, '`', '``'),
    '` SET `mustChangePassword` = FALSE WHERE `mustChangePassword` <> FALSE'
  )
);
PREPARE update_stmt FROM @update_sql;
EXECUTE update_stmt;
DEALLOCATE PREPARE update_stmt;
