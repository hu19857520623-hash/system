-- 退件管理表（ERP）
CREATE TABLE IF NOT EXISTS return_order (
  id BIGINT NOT NULL AUTO_INCREMENT,
  return_no VARCHAR(50) NOT NULL,
  customer_id BIGINT NOT NULL,
  oms_customer_code VARCHAR(30) NULL,
  order_no VARCHAR(50) NOT NULL,
  reference_no VARCHAR(100) NULL,
  tracking_no VARCHAR(100) NULL,
  seller_store_name VARCHAR(200) NULL,
  seller_tax_no VARCHAR(100) NULL,
  return_warehouse VARCHAR(20) NULL,
  expected_arrival_at DATETIME NULL,
  return_reason VARCHAR(200) NOT NULL,
  return_description TEXT NULL,
  requested_process VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_arrival',
  process_result VARCHAR(30) NULL,
  process_remark TEXT NULL,
  received_at DATETIME NULL,
  processed_at DATETIME NULL,
  processed_by BIGINT NULL,
  remark TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_return_no (return_no),
  KEY idx_return_oms_customer (oms_customer_code),
  KEY idx_return_status (status),
  KEY idx_return_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_order_item (
  id BIGINT NOT NULL AUTO_INCREMENT,
  return_id BIGINT NOT NULL,
  sku VARCHAR(50) NOT NULL,
  product_name VARCHAR(300) NOT NULL,
  quantity INT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_return_item_return (return_id),
  CONSTRAINT fk_return_item_return FOREIGN KEY (return_id) REFERENCES return_order (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
