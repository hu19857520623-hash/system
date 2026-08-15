-- Step 2.1 出库单表结构
CREATE TABLE IF NOT EXISTS outbound_order (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  outbound_no VARCHAR(30) NOT NULL UNIQUE,
  customer_id BIGINT NULL,
  warehouse_code VARCHAR(30) NOT NULL,
  dest_type VARCHAR(20) NOT NULL DEFAULT 'cpt',
  status VARCHAR(20) NOT NULL DEFAULT 'pending_pick',
  needs_relabel TINYINT(1) NOT NULL DEFAULT 0,
  relabel_confirmed_at DATETIME NULL,
  remark TEXT NULL,
  attachment_name VARCHAR(200) NULL,
  attachment_path VARCHAR(500) NULL,
  created_by BIGINT NULL,
  shipped_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ob_wh (warehouse_code),
  INDEX idx_ob_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outbound_order_item (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  outbound_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  sku VARCHAR(30) NOT NULL,
  product_name VARCHAR(300) NULL,
  qty INT NOT NULL,
  picked_qty INT NOT NULL DEFAULT 0,
  location_code VARCHAR(30) NULL,
  FOREIGN KEY (outbound_id) REFERENCES outbound_order(id) ON DELETE CASCADE
) ENGINE=InnoDB;
