CREATE TABLE IF NOT EXISTS oms_product_save (
  request_id VARCHAR(36) NOT NULL PRIMARY KEY,
  actor_id VARCHAR(50) NOT NULL,
  customer_id VARCHAR(50) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  product_id VARCHAR(50) NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_oms_product_save_actor (actor_id, customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
