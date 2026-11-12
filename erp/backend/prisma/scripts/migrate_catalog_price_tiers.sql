-- A preserves the existing final_price. Other tiers intentionally remain unpriced.
ALTER TABLE customer ADD COLUMN catalog_price_tier VARCHAR(1) NOT NULL DEFAULT 'A';
ALTER TABLE product_pricing
  ADD COLUMN price_b DECIMAL(12,2) NULL,
  ADD COLUMN price_c DECIMAL(12,2) NULL,
  ADD COLUMN price_d DECIMAL(12,2) NULL;
ALTER TABLE oms_catalog_order ADD COLUMN price_tier VARCHAR(1) NOT NULL DEFAULT 'A';
