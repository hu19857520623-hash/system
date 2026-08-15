-- product_dev 增加 sku 列
ALTER TABLE product_dev ADD COLUMN sku VARCHAR(30) NULL AFTER apply_no;

-- 为已有记录补全 SKU
UPDATE product_dev
SET sku = CONCAT('TK-', LPAD(id, 5, '0'))
WHERE sku IS NULL OR sku = '';

-- 唯一索引
CREATE UNIQUE INDEX idx_product_dev_sku ON product_dev (sku);
