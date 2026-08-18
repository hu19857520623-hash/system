-- Link OMS form fields to dedicated ERP columns. Safe to re-run.

-- ── product: OMS 建品字段 ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'customer_sku');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product ADD COLUMN customer_sku VARCHAR(50) NULL AFTER sku', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'declared_name_en');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product ADD COLUMN declared_name_en VARCHAR(300) NULL AFTER barcode', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'declared_name_cn');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product ADD COLUMN declared_name_cn VARCHAR(300) NULL AFTER declared_name_en', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'unit');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product ADD COLUMN unit VARCHAR(20) NULL AFTER declared_name_cn', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'has_battery');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product ADD COLUMN has_battery TINYINT NOT NULL DEFAULT 0 AFTER unit', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND INDEX_NAME = 'idx_product_customer_sku');
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_product_customer_sku ON product (customer_sku)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── inbound_order: OMS 预约入库字段（不再只塞 remark） ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'inbound_type');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE inbound_order ADD COLUMN inbound_type VARCHAR(50) NULL AFTER oms_customer_code', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'delivery_method');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE inbound_order ADD COLUMN delivery_method VARCHAR(50) NULL AFTER inbound_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'stock_source');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE inbound_order ADD COLUMN stock_source VARCHAR(30) NULL AFTER delivery_method', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'reference_no');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE inbound_order ADD COLUMN reference_no VARCHAR(100) NULL AFTER stock_source', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'eta');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE inbound_order ADD COLUMN eta VARCHAR(40) NULL AFTER reference_no', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'contact');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE inbound_order ADD COLUMN contact VARCHAR(100) NULL AFTER eta', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'contact_phone');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE inbound_order ADD COLUMN contact_phone VARCHAR(50) NULL AFTER contact', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- OMS 账户没有对应 ERP 客户时补一行，后续入库/出库才能双写
INSERT INTO customer (
  customer_code, customer_name, company_name, contact_email, contact_name, contact_phone,
  balance, status, created_at, updated_at
)
SELECT
  a.code,
  a.name,
  NULLIF(a.companyName, ''),
  NULLIF(a.email, ''),
  NULLIF(a.contact, ''),
  NULLIF(a.contactPhone, ''),
  0,
  1,
  NOW(3),
  NOW(3)
FROM oms_CustomerAccount a
LEFT JOIN customer c ON c.customer_code = a.code
WHERE c.customer_code IS NULL;

-- 从 OMS 商品回填 ERP 独立列
UPDATE product p
INNER JOIN oms_Product o ON o.internalSku = p.sku
SET
  p.customer_sku = COALESCE(NULLIF(p.customer_sku, ''), NULLIF(o.customerSku, '')),
  p.declared_name_en = COALESCE(NULLIF(p.declared_name_en, ''), NULLIF(o.declaredNameEn, '')),
  p.declared_name_cn = COALESCE(NULLIF(p.declared_name_cn, ''), NULLIF(o.declaredNameCn, '')),
  p.unit = COALESCE(NULLIF(p.unit, ''), NULLIF(o.unit, '')),
  p.has_battery = IF(o.hasBattery = 1, 1, p.has_battery),
  p.image_url = COALESCE(NULLIF(p.image_url, ''), IF(CHAR_LENGTH(o.image) BETWEEN 1 AND 500, o.image, NULL));

-- OMS 入库明细：历史行只有 skuHint，补成 lineItems JSON
UPDATE oms_InboundOrder
SET lineItems = JSON_ARRAY(JSON_OBJECT(
  'sku', skuHint,
  'name', skuHint,
  'qty', totalQty,
  'boxNo', 1,
  'packType', '自带包装',
  'stockType', '以仓库为准'
))
WHERE (lineItems IS NULL OR TRIM(lineItems) = '')
  AND skuHint IS NOT NULL
  AND TRIM(skuHint) <> '';

UPDATE oms_InboundOrder
SET customerId = '1'
WHERE customerId IS NULL OR TRIM(customerId) = '';

UPDATE oms_FeeRecord
SET paymentMethodId = COALESCE(NULLIF(paymentMethodId, ''), 'bank')
WHERE rechargeNo IS NOT NULL AND TRIM(rechargeNo) <> ''
  AND (paymentMethodId IS NULL OR TRIM(paymentMethodId) = '');
