-- 1B-5 物流仓收货 QC 字段
ALTER TABLE logistics_receipt_item
  ADD COLUMN damaged_qty INT NOT NULL DEFAULT 0 AFTER actual_qty,
  ADD COLUMN qc_status VARCHAR(20) NOT NULL DEFAULT 'pass' AFTER damaged_qty,
  ADD COLUMN qc_remark VARCHAR(500) NULL AFTER qc_status;
