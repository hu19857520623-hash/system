-- OMS 产品表增加客户可见 SKU 字段
ALTER TABLE oms_Product
  ADD COLUMN customerSku VARCHAR(50) NULL AFTER internalSku;

CREATE INDEX idx_oms_product_customer_sku ON oms_Product (customerSku);
