-- Preserve legacy product_desc verbatim; A/B variants cannot be inferred from old shop types.
ALTER TABLE lead_deal
  ADD COLUMN service_code VARCHAR(8) NULL,
  ADD COLUMN service_name VARCHAR(200) NULL,
  ADD INDEX idx_lead_deal_service (service_code);
