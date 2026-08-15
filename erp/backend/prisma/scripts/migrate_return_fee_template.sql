-- 退件收费模板
CREATE TABLE IF NOT EXISTS return_fee_template (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  template_code VARCHAR(50) NOT NULL,
  template_name VARCHAR(100) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  warehouse_code VARCHAR(20) NULL,
  customer_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_return_fee_template_code (template_code),
  KEY idx_return_fee_template_customer (customer_id),
  KEY idx_return_fee_template_wh (warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS return_fee_template_rule (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  template_id BIGINT NOT NULL,
  charge_type VARCHAR(40) NOT NULL,
  description VARCHAR(200) NOT NULL,
  calc_mode VARCHAR(30) NOT NULL COMMENT 'fixed|per_carton|per_cbm',
  unit_price DECIMAL(12, 2) NOT NULL,
  min_qty DECIMAL(12, 4) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  auto_apply TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_return_fee_rule_template (template_id),
  CONSTRAINT fk_return_fee_rule_template FOREIGN KEY (template_id) REFERENCES return_fee_template(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO return_fee_template (template_code, template_name, is_default, status)
SELECT 'default', '标准退件收费', 1, 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM return_fee_template WHERE template_code = 'default');

INSERT INTO return_fee_template_rule (template_id, charge_type, description, calc_mode, unit_price, min_qty, sort_order, auto_apply)
SELECT t.id, r.charge_type, r.description, r.calc_mode, r.unit_price, r.min_qty, r.sort_order, 1
FROM return_fee_template t
JOIN (
  SELECT 'return_receipt' AS charge_type, '退件收货清点费' AS description, 'fixed' AS calc_mode, 50.00 AS unit_price, NULL AS min_qty, 1 AS sort_order
  UNION ALL SELECT 'return_measure', '外箱体积测量费', 'per_carton', 15.00, NULL, 2
  UNION ALL SELECT 'return_handling', '退件操作费', 'per_cbm', 120.00, 0.01, 3
) r
WHERE t.template_code = 'default'
  AND NOT EXISTS (SELECT 1 FROM return_fee_template_rule rr WHERE rr.template_id = t.id);
