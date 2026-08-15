ALTER TABLE supplier_freight_bill
  ADD COLUMN po_id BIGINT NULL AFTER supplier_id,
  ADD COLUMN po_no VARCHAR(30) NULL AFTER po_id,
  ADD COLUMN source VARCHAR(30) NOT NULL DEFAULT 'manual' AFTER po_no,
  ADD UNIQUE INDEX uk_sfb_po_id (po_id),
  ADD INDEX idx_sfb_supplier (supplier_id);
