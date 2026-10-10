CREATE TABLE IF NOT EXISTS oms_snapshot_tombstone (
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(191) NOT NULL,
  deleted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
