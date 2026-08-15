-- Full schema sync: align MySQL with erp/backend/prisma/schema.prisma
-- Safe to re-run: skips objects that already exist (via information_schema checks)

-- ── inbound_order.oms_customer_code ──
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND COLUMN_NAME = 'oms_customer_code'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE inbound_order ADD COLUMN oms_customer_code VARCHAR(30) NULL AFTER remark',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order' AND INDEX_NAME = 'idx_inbound_oms_customer'
);
SET @sql_idx := IF(@idx_exists = 0,
  'CREATE INDEX idx_inbound_oms_customer ON inbound_order (oms_customer_code)',
  'SELECT 1');
PREPARE stmt2 FROM @sql_idx; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- ── product cost fields ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'sea_freight_per_unit');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product ADD COLUMN sea_freight_per_unit DECIMAL(12,2) NULL DEFAULT 0 AFTER cost_rmb', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'domestic_fee_per_unit');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product ADD COLUMN domestic_fee_per_unit DECIMAL(12,2) NULL DEFAULT 0 AFTER sea_freight_per_unit', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── product_pricing stock counters ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_pricing' AND COLUMN_NAME = 'inbound_qty');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product_pricing ADD COLUMN inbound_qty INT NOT NULL DEFAULT 0 AFTER purchase_qty', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_pricing' AND COLUMN_NAME = 'visible_stock_qty');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product_pricing ADD COLUMN visible_stock_qty INT NULL AFTER inbound_qty', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_pricing' AND COLUMN_NAME = 'sold_qty');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE product_pricing ADD COLUMN sold_qty INT NOT NULL DEFAULT 0 AFTER visible_stock_qty', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── customer_sku_inventory ──
CREATE TABLE IF NOT EXISTS customer_sku_inventory (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  sku VARCHAR(30) NOT NULL,
  product_name VARCHAR(300) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NULL,
  pricing_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_customer_sku_inv (customer_id, sku),
  INDEX idx_csi_customer (customer_id),
  INDEX idx_csi_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── oms_catalog_order ──
CREATE TABLE IF NOT EXISTS oms_catalog_order (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(50) NOT NULL,
  customer_id BIGINT NOT NULL,
  customer_code VARCHAR(30) NULL,
  sku VARCHAR(30) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  balance_before DECIMAL(14,2) NULL,
  balance_after DECIMAL(14,2) NULL,
  pricing_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY oms_catalog_order_order_no_key (order_no),
  INDEX idx_oms_order_customer_sku (customer_id, sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── inbound_carton ──
CREATE TABLE IF NOT EXISTS inbound_carton (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inbound_id BIGINT NOT NULL,
  box_code VARCHAR(50) NOT NULL,
  box_seq INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  received_at DATETIME NULL,
  received_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_inbound_box_code (inbound_id, box_code),
  INDEX idx_carton_inbound_status (inbound_id, status),
  CONSTRAINT fk_inbound_carton_inbound FOREIGN KEY (inbound_id) REFERENCES inbound_order(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── inbound_carton_item ──
CREATE TABLE IF NOT EXISTS inbound_carton_item (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  carton_id BIGINT NOT NULL,
  inbound_item_id BIGINT NULL,
  product_id BIGINT NOT NULL,
  sku VARCHAR(30) NOT NULL,
  qty INT NOT NULL,
  INDEX idx_carton_item_carton (carton_id),
  CONSTRAINT fk_inbound_carton_item_carton FOREIGN KEY (carton_id) REFERENCES inbound_carton(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── outbound_order (P3 fields, idempotent) ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'cargo_type');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN cargo_type VARCHAR(30) NULL AFTER carrier', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'fba_warehouse');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN fba_warehouse VARCHAR(30) NULL AFTER cargo_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'picking_started_at');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN picking_started_at DATETIME(3) NULL AFTER pick_source', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'picked_at');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN picked_at DATETIME(3) NULL AFTER picking_started_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS outbound_attachment (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  outbound_id BIGINT NOT NULL,
  file_type VARCHAR(30) NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  sku VARCHAR(30) NULL,
  platform_barcode VARCHAR(100) NULL,
  unit_index INT NULL,
  source_page INT NULL,
  source_row INT NULL,
  source_column INT NULL,
  label_role VARCHAR(30) NULL,
  content_hash CHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ob_att_outbound (outbound_id),
  INDEX idx_ob_att_label (outbound_id, file_type, sku, unit_index),
  CONSTRAINT fk_ob_att_outbound FOREIGN KEY (outbound_id) REFERENCES outbound_order(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

-- ── outbound takealot meta ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'seller_store_name');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN seller_store_name VARCHAR(200) NULL AFTER fba_no', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'takealot_seller_id');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN takealot_seller_id VARCHAR(30) NULL AFTER seller_store_name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'takealot_booking_ref');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN takealot_booking_ref VARCHAR(50) NULL AFTER takealot_seller_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_order' AND COLUMN_NAME = 'shipment_due_date');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE outbound_order ADD COLUMN shipment_due_date DATE NULL AFTER takealot_booking_ref', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- appointment_date as DATETIME
ALTER TABLE outbound_order MODIFY appointment_date DATETIME NULL;

-- ── OMS outbound takealot fields ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_OutboundOrder' AND COLUMN_NAME = 'sellerStoreName');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_OutboundOrder ADD COLUMN sellerStoreName VARCHAR(200) NULL AFTER scheduledDeliveryDate', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_OutboundOrder' AND COLUMN_NAME = 'takealotDestWarehouse');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_OutboundOrder ADD COLUMN takealotDestWarehouse VARCHAR(20) NULL AFTER sellerStoreName', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_OutboundOrder' AND COLUMN_NAME = 'takealotSellerId');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_OutboundOrder ADD COLUMN takealotSellerId VARCHAR(30) NULL AFTER takealotDestWarehouse', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_OutboundOrder' AND COLUMN_NAME = 'takealotBookingRef');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_OutboundOrder ADD COLUMN takealotBookingRef VARCHAR(50) NULL AFTER takealotSellerId', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_OutboundOrder' AND COLUMN_NAME = 'shipmentDueDate');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_OutboundOrder ADD COLUMN shipmentDueDate VARCHAR(40) NULL AFTER takealotBookingRef', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── OMS return phase2 ──
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_ReturnOrder' AND COLUMN_NAME = 'estimated_fee_total');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_ReturnOrder ADD COLUMN estimated_fee_total VARCHAR(30) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_ReturnOrder' AND COLUMN_NAME = 'total_volume_cbm');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_ReturnOrder ADD COLUMN total_volume_cbm VARCHAR(30) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_ReturnOrder' AND COLUMN_NAME = 'inspection_result');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_ReturnOrder ADD COLUMN inspection_result VARCHAR(30) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_ReturnOrder' AND COLUMN_NAME = 'inspection_remark');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_ReturnOrder ADD COLUMN inspection_remark TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_ReturnOrder' AND COLUMN_NAME = 'customer_decision');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_ReturnOrder ADD COLUMN customer_decision VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_ReturnOrder' AND COLUMN_NAME = 'customer_decided_at');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_ReturnOrder ADD COLUMN customer_decided_at VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oms_ReturnOrder' AND COLUMN_NAME = 'customer_process_choice');
SET @sql := IF(@col_exists = 0, 'ALTER TABLE oms_ReturnOrder ADD COLUMN customer_process_choice VARCHAR(30) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
