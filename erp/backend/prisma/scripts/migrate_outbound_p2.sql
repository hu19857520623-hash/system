-- 出库单 P2：批次/平台/预约/复核/打托/送达
ALTER TABLE outbound_order
  ADD COLUMN batch_no VARCHAR(50) NULL COMMENT '批次号/柜号' AFTER problem_remark,
  ADD COLUMN platform VARCHAR(30) NULL COMMENT '平台' AFTER batch_no,
  ADD COLUMN appointment_status VARCHAR(30) NULL COMMENT '平台预约状态' AFTER platform,
  ADD COLUMN reviewer_id BIGINT NULL COMMENT '复核人' AFTER appointment_status,
  ADD COLUMN reviewed_at DATETIME NULL COMMENT '复核时间' AFTER reviewer_id,
  ADD COLUMN is_palletized TINYINT(1) NOT NULL DEFAULT 0 COMMENT '已打托' AFTER reviewed_at,
  ADD COLUMN pallet_info VARCHAR(200) NULL COMMENT '打托信息' AFTER is_palletized,
  ADD COLUMN delivered_at DATETIME NULL COMMENT '送达时间' AFTER shipped_at;

-- 原「待打包 picked」并入复核中
UPDATE outbound_order SET status = 'reviewing' WHERE status = 'picked';
