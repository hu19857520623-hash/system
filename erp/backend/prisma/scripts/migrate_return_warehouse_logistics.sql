-- 退件物流费：按仓计费重(kg) × 单价；体积重 = 长×宽×高÷5000 (cm)
-- JHB3: 4 RMB/kg | CPT2: 6 RMB/kg (8kg起) | DBN: 7 RMB/kg (8kg起)

DELETE r FROM return_fee_template_rule r
JOIN return_fee_template t ON t.id = r.template_id
WHERE t.is_default = 1 AND t.template_code = 'default';

INSERT INTO return_fee_template_rule (template_id, charge_type, description, calc_mode, unit_price, min_qty, sort_order, auto_apply)
SELECT t.id, 'return_logistics', '退件物流费（系统默认 · JHB3 · 4 RMB/kg）', 'per_chargeable_weight', 4.00, NULL, 1, 1
FROM return_fee_template t
WHERE t.template_code = 'default'
  AND NOT EXISTS (SELECT 1 FROM return_fee_template_rule rr WHERE rr.template_id = t.id);

INSERT INTO return_fee_template (template_code, template_name, is_default, warehouse_code, status)
SELECT 'wh_jhb3', 'JHB3 退件物流', 0, 'JHB3', 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM return_fee_template WHERE template_code = 'wh_jhb3');

INSERT INTO return_fee_template (template_code, template_name, is_default, warehouse_code, status)
SELECT 'wh_cpt2', 'CPT2 退件物流', 0, 'CPT2', 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM return_fee_template WHERE template_code = 'wh_cpt2');

INSERT INTO return_fee_template (template_code, template_name, is_default, warehouse_code, status)
SELECT 'wh_dbn', 'DBN 退件物流', 0, 'DBN', 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM return_fee_template WHERE template_code = 'wh_dbn');

INSERT INTO return_fee_template_rule (template_id, charge_type, description, calc_mode, unit_price, min_qty, sort_order, auto_apply)
SELECT t.id, 'return_logistics', '退件物流费（JHB3 · 4 RMB/kg）', 'per_chargeable_weight', 4.00, NULL, 1, 1
FROM return_fee_template t
WHERE t.template_code = 'wh_jhb3'
  AND NOT EXISTS (SELECT 1 FROM return_fee_template_rule rr WHERE rr.template_id = t.id);

INSERT INTO return_fee_template_rule (template_id, charge_type, description, calc_mode, unit_price, min_qty, sort_order, auto_apply)
SELECT t.id, 'return_logistics', '退件物流费（CPT2 · 6 RMB/kg，8kg 起）', 'per_chargeable_weight', 6.00, 8.0000, 1, 1
FROM return_fee_template t
WHERE t.template_code = 'wh_cpt2'
  AND NOT EXISTS (SELECT 1 FROM return_fee_template_rule rr WHERE rr.template_id = t.id);

INSERT INTO return_fee_template_rule (template_id, charge_type, description, calc_mode, unit_price, min_qty, sort_order, auto_apply)
SELECT t.id, 'return_logistics', '退件物流费（DBN · 7 RMB/kg，8kg 起）', 'per_chargeable_weight', 7.00, 8.0000, 1, 1
FROM return_fee_template t
WHERE t.template_code = 'wh_dbn'
  AND NOT EXISTS (SELECT 1 FROM return_fee_template_rule rr WHERE rr.template_id = t.id);
