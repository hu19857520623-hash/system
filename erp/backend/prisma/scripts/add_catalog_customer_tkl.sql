-- 平台货盘注册为客户 TKL，并将货盘 SKU 前缀为 TKL-{原SKU}

INSERT INTO customer (customer_code, customer_name, contact_name, balance, status, created_at, updated_at)
SELECT 'TKL', '平台货盘', '系统', 0, 1, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM customer WHERE customer_code = 'TKL');

UPDATE product_pricing
SET sku = CONCAT('TKL-', sku)
WHERE sku NOT LIKE 'TKL-%';

UPDATE customer_sku_inventory
SET sku = CONCAT('TKL-', sku)
WHERE sku NOT LIKE 'TKL-%';

UPDATE oms_catalog_order
SET sku = CONCAT('TKL-', sku)
WHERE sku NOT LIKE 'TKL-%';
