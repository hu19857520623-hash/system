-- Sync outbound_order / outbound_attachment with Prisma schema (safe to re-run: skip existing objects manually if needed)

CREATE TABLE IF NOT EXISTS outbound_attachment (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  outbound_id BIGINT NOT NULL,
  file_type VARCHAR(30) NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ob_att_outbound (outbound_id),
  CONSTRAINT fk_ob_att_outbound FOREIGN KEY (outbound_id) REFERENCES outbound_order(id) ON DELETE CASCADE
);

ALTER TABLE outbound_order ADD COLUMN cargo_type VARCHAR(30) NULL AFTER carrier;
ALTER TABLE outbound_order ADD COLUMN fba_warehouse VARCHAR(30) NULL AFTER cargo_type;
ALTER TABLE outbound_order ADD COLUMN picking_started_at DATETIME(3) NULL AFTER pick_source;
ALTER TABLE outbound_order ADD COLUMN picked_at DATETIME(3) NULL AFTER picking_started_at;
