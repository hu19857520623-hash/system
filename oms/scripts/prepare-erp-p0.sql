-- P0 演示数据：确保 ERP 有可售货盘 + 与 OMS 对齐的客户
-- 用法: docker exec -i erp-mysql mysql -uroot -p... --default-character-set=utf8mb4 takealot_erp < scripts/prepare-erp-p0.sql

-- 货盘客户（OMS catalog 角色绑定 CUS-DEMO-001）
INSERT INTO customer (customer_code, customer_name, contact_name, contact_phone, balance, status, created_at, updated_at)
SELECT 'CUS-DEMO-001', '开普敦贸易', 'John', '+27-82-1234567', 50000.00, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM customer WHERE customer_code = 'CUS-DEMO-001');

UPDATE customer
SET customer_name = '开普敦贸易', balance = GREATEST(balance, 50000.00), status = 1, updated_at = NOW(3)
WHERE customer_code = 'CUS-DEMO-001';

-- 混合客户（OMS hybrid 角色预留）
INSERT INTO customer (customer_code, customer_name, contact_name, contact_phone, balance, status, created_at, updated_at)
SELECT 'SA-2024-0288', '约翰内斯堡双业态', 'Mike Botha', '+27-82-0000288', 30000.00, 1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM customer WHERE customer_code = 'SA-2024-0288');

-- 将 tkl-009900 定价并同步 OMS，开放下单（WMS 已有库存）
UPDATE product_pricing
SET
  final_price = IFNULL(final_price, 89.00),
  market_price = IFNULL(market_price, 120.00),
  pricing_logic = IFNULL(pricing_logic, 'P0 演示定价'),
  visible_stock_qty = IFNULL(visible_stock_qty, 100),
  inbound_qty = GREATEST(IFNULL(inbound_qty, 0), 100),
  pricing_status = 'synced',
  visible_on_oms = 1,
  orderable_on_oms = 1,
  oms_sync_at = NOW(3),
  visible_on_oms_at = IFNULL(visible_on_oms_at, NOW(3)),
  orderable_on_oms_at = IFNULL(orderable_on_oms_at, NOW(3)),
  updated_at = NOW(3)
WHERE sku = 'tkl-009900';

UPDATE product
SET sync_status = 'synced', updated_at = NOW(3)
WHERE sku = 'tkl-009900';
