-- 发运海外仓：外箱装箱规格（创建入库单时录入）
ALTER TABLE inbound_carton
  ADD COLUMN IF NOT EXISTS length_cm DECIMAL(10, 2) NULL AFTER box_seq,
  ADD COLUMN IF NOT EXISTS width_cm DECIMAL(10, 2) NULL AFTER length_cm,
  ADD COLUMN IF NOT EXISTS height_cm DECIMAL(10, 2) NULL AFTER width_cm,
  ADD COLUMN IF NOT EXISTS gross_weight_kg DECIMAL(10, 3) NULL AFTER height_cm,
  ADD COLUMN IF NOT EXISTS remark VARCHAR(200) NULL AFTER gross_weight_kg;
