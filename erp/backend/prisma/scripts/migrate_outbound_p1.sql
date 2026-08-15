-- 出库单 P1：物流产品、承运商、拣货员、问题件
ALTER TABLE outbound_order
  ADD COLUMN logistics_product VARCHAR(50) NULL COMMENT '物流产品' AFTER tracking_no,
  ADD COLUMN carrier VARCHAR(50) NULL COMMENT '承运商' AFTER logistics_product,
  ADD COLUMN picker_id BIGINT NULL COMMENT '拣货员' AFTER carrier,
  ADD COLUMN is_problem TINYINT(1) NOT NULL DEFAULT 0 COMMENT '问题件' AFTER picker_id,
  ADD COLUMN problem_remark VARCHAR(200) NULL COMMENT '问题说明' AFTER is_problem;
