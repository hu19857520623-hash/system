-- 退件收货 · 测体积 · 算费（第一期）
ALTER TABLE return_order
  ADD COLUMN received_qty INT NULL COMMENT '实收件数' AFTER received_at,
  ADD COLUMN received_carton_count INT NULL COMMENT '实收箱数' AFTER received_qty,
  ADD COLUMN total_volume_cbm DECIMAL(10,6) NULL COMMENT '总体积CBM' AFTER received_carton_count,
  ADD COLUMN total_gross_weight_kg DECIMAL(10,3) NULL COMMENT '总毛重kg' AFTER total_volume_cbm,
  ADD COLUMN total_chargeable_weight_kg DECIMAL(10,3) NULL COMMENT '总计费重kg' AFTER total_gross_weight_kg,
  ADD COLUMN estimated_fee_total DECIMAL(14,2) NULL COMMENT '预估费用合计' AFTER total_chargeable_weight_kg,
  ADD COLUMN fee_status VARCHAR(20) NULL DEFAULT 'none' COMMENT 'none|estimated|confirmed|charged' AFTER estimated_fee_total,
  ADD COLUMN measured_at DATETIME NULL AFTER fee_status,
  ADD COLUMN fee_calculated_at DATETIME NULL AFTER measured_at,
  ADD COLUMN received_by BIGINT NULL AFTER fee_calculated_at;

CREATE TABLE IF NOT EXISTS return_carton_measure (
  id BIGINT NOT NULL AUTO_INCREMENT,
  return_id BIGINT NOT NULL,
  carton_no INT NOT NULL DEFAULT 1,
  length_cm DECIMAL(10,2) NOT NULL,
  width_cm DECIMAL(10,2) NOT NULL,
  height_cm DECIMAL(10,2) NOT NULL,
  gross_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0,
  volume_cbm DECIMAL(10,6) NOT NULL,
  volumetric_weight_kg DECIMAL(10,3) NOT NULL,
  chargeable_weight_kg DECIMAL(10,3) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_return_carton_return (return_id),
  CONSTRAINT fk_return_carton_return FOREIGN KEY (return_id) REFERENCES return_order (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
