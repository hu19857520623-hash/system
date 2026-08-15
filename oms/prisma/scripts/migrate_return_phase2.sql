-- OMS 退件扩展字段（第二期）
ALTER TABLE oms_ReturnOrder
  ADD COLUMN estimated_fee_total VARCHAR(30) NULL,
  ADD COLUMN total_volume_cbm VARCHAR(30) NULL,
  ADD COLUMN inspection_result VARCHAR(30) NULL,
  ADD COLUMN inspection_remark TEXT NULL,
  ADD COLUMN customer_decision VARCHAR(20) NULL,
  ADD COLUMN customer_decided_at VARCHAR(40) NULL,
  ADD COLUMN customer_process_choice VARCHAR(30) NULL;
