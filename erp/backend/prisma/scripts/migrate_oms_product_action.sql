CREATE TABLE IF NOT EXISTS oms_product_action (
  request_id VARCHAR(36) NOT NULL PRIMARY KEY,
  actor_id VARCHAR(50) NOT NULL,
  scope_key CHAR(64) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  action VARCHAR(16) NOT NULL,
  product_ids MEDIUMTEXT NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_oms_product_action_actor (actor_id, scope_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oms_product_discard_origin (
  product_id VARCHAR(50) NOT NULL PRIMARY KEY,
  customer_id VARCHAR(50) NOT NULL,
  from_status VARCHAR(30) NOT NULL,
  KEY idx_oms_product_discard_owner (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
