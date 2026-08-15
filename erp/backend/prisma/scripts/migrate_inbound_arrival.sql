-- 海外仓到仓扫描：入仓号/跟踪号、到仓时间、扫描日志
ALTER TABLE inbound_order
  ADD COLUMN warehouse_no VARCHAR(30) NULL COMMENT '入仓号' AFTER warehouse_code,
  ADD COLUMN tracking_no VARCHAR(50) NULL COMMENT '物流跟踪号' AFTER warehouse_no,
  ADD COLUMN arrived_at DATETIME NULL COMMENT '到仓扫描时间' AFTER push_wms_at,
  ADD COLUMN arrived_by BIGINT NULL COMMENT '到仓扫描人' AFTER arrived_at;

CREATE TABLE IF NOT EXISTS inbound_arrival_scan (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  inbound_id BIGINT NOT NULL,
  scan_code VARCHAR(50) NOT NULL,
  scan_type VARCHAR(20) NOT NULL COMMENT 'inbound_no/warehouse_no/tracking_no',
  warehouse_code VARCHAR(30) NOT NULL,
  operator_id BIGINT NULL,
  scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arrival_inbound (inbound_id),
  INDEX idx_arrival_wh_time (warehouse_code, scanned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='海外仓到仓扫描记录';
