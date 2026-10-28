CREATE TABLE IF NOT EXISTS oms_product_import (
  request_id VARCHAR(36) NOT NULL,
  actor_id VARCHAR(50) NOT NULL,
  customer_id VARCHAR(50) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  product_ids MEDIUMTEXT NOT NULL,
  row_count INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_id),
  KEY idx_oms_product_import_actor (actor_id, customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
