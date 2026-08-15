-- 采购单：支持主管核定数量 vs 实际采购、国内运费
ALTER TABLE purchase_order ADD COLUMN domestic_freight DECIMAL(12,2) NULL AFTER total_amount;
ALTER TABLE purchase_order_item ADD COLUMN planned_qty INT NULL AFTER product_name;
ALTER TABLE purchase_order_item ADD COLUMN domestic_freight DECIMAL(12,2) NULL AFTER amount;
