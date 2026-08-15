CREATE TABLE IF NOT EXISTS billing_charge (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  charge_no VARCHAR(30) NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL,
  charge_type VARCHAR(30) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  description VARCHAR(500),
  amount DECIMAL(14,2) NOT NULL,
  quantity INT DEFAULT 1,
  unit_price DECIMAL(12,2),
  charge_date DATE NOT NULL,
  biz_ref VARCHAR(100),
  source_ref VARCHAR(100),
  warehouse_code VARCHAR(30),
  status VARCHAR(20) DEFAULT 'pending',
  billing_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_billing_charge_customer_date (customer_id, charge_date, id),
  INDEX ix_billing_charge_status_date (status, charge_date, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inbound_draft (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  draft_no VARCHAR(30) NOT NULL UNIQUE,
  operator_id BIGINT NULL,
  form_data JSON NOT NULL,
  saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_inbound_draft_operator_saved (operator_id, saved_at, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inbound_attachment (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  inbound_id BIGINT NULL,
  draft_no VARCHAR(30) NULL,
  file_name VARCHAR(200) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_inbound_attachment_inbound (inbound_id, id),
  INDEX ix_inbound_attachment_draft (draft_no, id)
) ENGINE=InnoDB;
