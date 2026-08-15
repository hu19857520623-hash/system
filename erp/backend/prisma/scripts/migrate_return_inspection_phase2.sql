-- 退件质检与客户决策（第二期）
ALTER TABLE return_order
  ADD COLUMN inspection_result VARCHAR(30) NULL COMMENT 'good|defective|mixed|unknown' AFTER fee_calculated_at,
  ADD COLUMN inspection_remark TEXT NULL AFTER inspection_result,
  ADD COLUMN inspected_at DATETIME NULL AFTER inspection_remark,
  ADD COLUMN inspected_by BIGINT NULL AFTER inspected_at,
  ADD COLUMN customer_decision VARCHAR(20) NULL DEFAULT 'pending' AFTER inspected_by,
  ADD COLUMN customer_decided_at DATETIME NULL AFTER customer_decision,
  ADD COLUMN customer_process_choice VARCHAR(30) NULL AFTER customer_decided_at,
  ADD COLUMN decision_deadline DATETIME NULL AFTER customer_process_choice;
