-- DB integrity checks for shared takealot_erp (ERP + oms_* OMS)
USE takealot_erp;

SELECT '=== A. schema isolation ===' AS section;
SELECT SCHEMA_NAME AS leftover_oms_db
FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME = 'takealot_oms';

SELECT '=== B. required OMS tables ===' AS section;
SELECT t.expected_table,
       CASE WHEN x.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM (
  SELECT 'oms_CustomerAccount' AS expected_table UNION ALL
  SELECT 'oms_BillingAccount' UNION ALL
  SELECT 'oms_FeeRecord' UNION ALL
  SELECT 'oms_StoreAccount' UNION ALL
  SELECT 'oms_Product' UNION ALL
  SELECT 'oms_InventoryItem' UNION ALL
  SELECT 'oms_Order' UNION ALL
  SELECT 'oms_InboundOrder' UNION ALL
  SELECT 'oms_OutboundOrder' UNION ALL
  SELECT 'oms_CodeMapping' UNION ALL
  SELECT 'oms_PlatformSkuMapping' UNION ALL
  SELECT 'oms_LogisticsRecord' UNION ALL
  SELECT 'oms_QcReport' UNION ALL
  SELECT 'oms_SystemMessage' UNION ALL
  SELECT 'oms_Announcement' UNION ALL
  SELECT 'oms_PriceTemplate' UNION ALL
  SELECT 'oms_StorageRentTemplate' UNION ALL
  SELECT 'oms_RegionDispatchRule' UNION ALL
  SELECT 'oms_CatalogPurchase' UNION ALL
  SELECT 'oms_PaymentMethod'
) t
LEFT JOIN information_schema.TABLES x
  ON x.table_schema = 'takealot_erp' AND x.table_name = t.expected_table
ORDER BY status DESC, expected_table;

SELECT '=== C. required ERP core tables ===' AS section;
SELECT t.expected_table,
       CASE WHEN x.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM (
  SELECT 'customer' AS expected_table UNION ALL
  SELECT 'product' UNION ALL
  SELECT 'inbound_order' UNION ALL
  SELECT 'outbound_order' UNION ALL
  SELECT 'announcement' UNION ALL
  SELECT 'billing_charge' UNION ALL
  SELECT 'sys_user' UNION ALL
  SELECT 'warehouse' UNION ALL
  SELECT 'inventory' UNION ALL
  SELECT 'oms_catalog_order' UNION ALL
  SELECT 'product_pricing'
) t
LEFT JOIN information_schema.TABLES x
  ON x.table_schema = 'takealot_erp' AND x.table_name = t.expected_table
ORDER BY status DESC, expected_table;

SELECT '=== D. name collision check (case-insensitive) ===' AS section;
SELECT LOWER(table_name) AS name_lc, GROUP_CONCAT(table_name ORDER BY table_name) AS physical_names, COUNT(*) AS n
FROM information_schema.TABLES
WHERE table_schema = 'takealot_erp'
GROUP BY LOWER(table_name)
HAVING COUNT(*) > 1;

SELECT '=== E. OMS row counts ===' AS section;
SELECT 'oms_CustomerAccount' AS tbl, COUNT(*) AS cnt FROM oms_CustomerAccount
UNION ALL SELECT 'oms_BillingAccount', COUNT(*) FROM oms_BillingAccount
UNION ALL SELECT 'oms_FeeRecord', COUNT(*) FROM oms_FeeRecord
UNION ALL SELECT 'oms_StoreAccount', COUNT(*) FROM oms_StoreAccount
UNION ALL SELECT 'oms_Product', COUNT(*) FROM oms_Product
UNION ALL SELECT 'oms_InventoryItem', COUNT(*) FROM oms_InventoryItem
UNION ALL SELECT 'oms_Order', COUNT(*) FROM oms_Order
UNION ALL SELECT 'oms_InboundOrder', COUNT(*) FROM oms_InboundOrder
UNION ALL SELECT 'oms_OutboundOrder', COUNT(*) FROM oms_OutboundOrder
UNION ALL SELECT 'oms_CodeMapping', COUNT(*) FROM oms_CodeMapping
UNION ALL SELECT 'oms_PlatformSkuMapping', COUNT(*) FROM oms_PlatformSkuMapping
UNION ALL SELECT 'oms_LogisticsRecord', COUNT(*) FROM oms_LogisticsRecord
UNION ALL SELECT 'oms_QcReport', COUNT(*) FROM oms_QcReport
UNION ALL SELECT 'oms_SystemMessage', COUNT(*) FROM oms_SystemMessage
UNION ALL SELECT 'oms_Announcement', COUNT(*) FROM oms_Announcement
UNION ALL SELECT 'oms_PriceTemplate', COUNT(*) FROM oms_PriceTemplate
UNION ALL SELECT 'oms_StorageRentTemplate', COUNT(*) FROM oms_StorageRentTemplate
UNION ALL SELECT 'oms_RegionDispatchRule', COUNT(*) FROM oms_RegionDispatchRule
UNION ALL SELECT 'oms_CatalogPurchase', COUNT(*) FROM oms_CatalogPurchase
UNION ALL SELECT 'oms_PaymentMethod', COUNT(*) FROM oms_PaymentMethod;

SELECT '=== F. ERP row counts ===' AS section;
SELECT 'customer' AS tbl, COUNT(*) AS cnt FROM customer
UNION ALL SELECT 'product', COUNT(*) FROM product
UNION ALL SELECT 'sys_user', COUNT(*) FROM sys_user
UNION ALL SELECT 'warehouse', COUNT(*) FROM warehouse
UNION ALL SELECT 'inventory', COUNT(*) FROM inventory
UNION ALL SELECT 'inbound_order', COUNT(*) FROM inbound_order
UNION ALL SELECT 'outbound_order', COUNT(*) FROM outbound_order
UNION ALL SELECT 'announcement', COUNT(*) FROM announcement
UNION ALL SELECT 'billing_charge', COUNT(*) FROM billing_charge
UNION ALL SELECT 'customer_recharge', COUNT(*) FROM customer_recharge
UNION ALL SELECT 'oms_catalog_order', COUNT(*) FROM oms_catalog_order
UNION ALL SELECT 'product_pricing', COUNT(*) FROM product_pricing;

SELECT '=== G. OMS FK orphans ===' AS section;
SELECT 'BillingAccount orphan customerId' AS check_name, COUNT(*) AS bad
FROM oms_BillingAccount b LEFT JOIN oms_CustomerAccount c ON c.id = b.customerId WHERE c.id IS NULL
UNION ALL
SELECT 'StoreAccount orphan', COUNT(*) FROM oms_StoreAccount s LEFT JOIN oms_CustomerAccount c ON c.id = s.customerId WHERE s.customerId IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'Product orphan', COUNT(*) FROM oms_Product p LEFT JOIN oms_CustomerAccount c ON c.id = p.customerId WHERE p.customerId IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'InventoryItem orphan', COUNT(*) FROM oms_InventoryItem i LEFT JOIN oms_CustomerAccount c ON c.id = i.customerId WHERE i.customerId IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'Order orphan', COUNT(*) FROM oms_Order o LEFT JOIN oms_CustomerAccount c ON c.id = o.customerId WHERE o.customerId IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'InboundOrder orphan', COUNT(*) FROM oms_InboundOrder o LEFT JOIN oms_CustomerAccount c ON c.id = o.customerId WHERE o.customerId IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'OutboundOrder orphan', COUNT(*) FROM oms_OutboundOrder o LEFT JOIN oms_CustomerAccount c ON c.id = o.customerId WHERE o.customerId IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT 'PlatformSkuMapping orphan', COUNT(*) FROM oms_PlatformSkuMapping m LEFT JOIN oms_CustomerAccount c ON c.id = m.customerId WHERE m.customerId IS NOT NULL AND c.id IS NULL;

SELECT '=== H. OMS unique key duplicates ===' AS section;
SELECT 'dup CustomerAccount.code' AS check_name, COUNT(*) AS bad FROM (
  SELECT code FROM oms_CustomerAccount GROUP BY code HAVING COUNT(*) > 1
) x
UNION ALL
SELECT 'dup Order.orderNo', COUNT(*) FROM (SELECT orderNo FROM oms_Order GROUP BY orderNo HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'dup InboundOrder.inboundNo', COUNT(*) FROM (SELECT inboundNo FROM oms_InboundOrder GROUP BY inboundNo HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'dup OutboundOrder.outboundNo', COUNT(*) FROM (SELECT outboundNo FROM oms_OutboundOrder GROUP BY outboundNo HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'dup BillingAccount.customerId', COUNT(*) FROM (SELECT customerId FROM oms_BillingAccount GROUP BY customerId HAVING COUNT(*) > 1) x;

SELECT '=== I. OMS FK constraints present ===' AS section;
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'takealot_erp'
  AND TABLE_NAME LIKE 'oms\\_%'
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

SELECT '=== J. ERP/OMS customer code bridge ===' AS section;
SELECT o.code AS oms_code,
       CASE WHEN e.customer_code IS NULL THEN 'NO_ERP_MATCH' ELSE 'LINKED' END AS erp_link,
       e.balance AS erp_balance,
       b.creditBalance AS oms_billing_balance
FROM oms_CustomerAccount o
LEFT JOIN customer e ON e.customer_code = o.code
LEFT JOIN oms_BillingAccount b ON b.customerId = o.id
ORDER BY o.code;

SELECT '=== K. engine/charset ===' AS section;
SELECT table_name, engine, table_collation
FROM information_schema.TABLES
WHERE table_schema = 'takealot_erp'
  AND (table_name LIKE 'oms\\_%' OR table_name IN ('customer','product','inbound_order','outbound_order'))
  AND (engine <> 'InnoDB' OR table_collation NOT LIKE 'utf8mb4%')
ORDER BY table_name;
