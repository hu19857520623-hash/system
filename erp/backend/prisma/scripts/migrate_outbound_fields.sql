-- 出库单 P0：FBA 编号、跟踪号
ALTER TABLE outbound_order
  ADD COLUMN fba_no VARCHAR(50) NULL COMMENT 'FBA编号' AFTER dest_type,
  ADD COLUMN tracking_no VARCHAR(50) NULL COMMENT '物流跟踪号' AFTER fba_no;
