-- 出库 SOP P0：预约送仓日期、拣货/复核来源、换标扫码、POD 扫码
ALTER TABLE outbound_order
  ADD COLUMN appointment_date DATE NULL COMMENT '预约送仓日期' AFTER appointment_status,
  ADD COLUMN pick_source VARCHAR(20) NULL COMMENT '拣货来源 pda|pick_list' AFTER picker_id,
  ADD COLUMN review_source VARCHAR(20) NULL COMMENT '复核来源 pda|pick_list' AFTER reviewed_at,
  ADD COLUMN pod_code VARCHAR(80) NULL COMMENT 'POD扫描码' AFTER delivered_at,
  ADD COLUMN pod_scanned_at DATETIME NULL COMMENT 'POD扫描时间' AFTER pod_code;

ALTER TABLE outbound_order_item
  ADD COLUMN old_barcode VARCHAR(50) NULL COMMENT '换标扫描的旧条码' AFTER location_code,
  ADD COLUMN new_barcode VARCHAR(50) NULL COMMENT '新条码/新FNSKU' AFTER old_barcode,
  ADD COLUMN relabel_scanned_at DATETIME NULL COMMENT '换标扫描时间' AFTER new_barcode;

CREATE INDEX idx_ob_appointment_date ON outbound_order (appointment_date);
