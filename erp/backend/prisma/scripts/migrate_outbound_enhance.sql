-- 出库增强：多附件子表、箱货类型、FBA目的仓、拣货时间戳
-- 执行：npx prisma db push 后可选运行本脚本做历史数据回填

-- 回填箱货类型（按现有字段推导）
UPDATE outbound_order
SET cargo_type = CASE
  WHEN needs_relabel = 1 THEN 'relabel_outbound'
  WHEN platform = 'Takealot' OR dest_type = 'local' AND logistics_product LIKE '%JHB%' THEN 'takealot_inbound'
  WHEN dest_type = 'fba' THEN 'fba_transfer'
  WHEN dest_type = 'cpt' THEN 'cpt_pickup'
  ELSE 'dropship_sku'
END
WHERE cargo_type IS NULL OR cargo_type = '';

-- Takealot 目的仓：从历史 logistics_product / 独立字段回填
UPDATE outbound_order
SET fba_warehouse = logistics_product
WHERE (fba_warehouse IS NULL OR fba_warehouse = '')
  AND logistics_product IN ('JHB1', 'CPT1', 'DBN1', 'JHB', 'CPT', 'DBN');

-- 旧单 reviewing 且已有拣货明细 → 视为已拣货（可选，按需执行）
-- UPDATE outbound_order o
-- SET status = 'picked', picked_at = COALESCE(picked_at, updated_at)
-- WHERE o.status = 'reviewing'
--   AND EXISTS (SELECT 1 FROM outbound_order_item i WHERE i.outbound_id = o.id AND i.picked_qty > 0);

-- 主表附件迁移到子表（仅尚无子表记录时）
INSERT INTO outbound_attachment (outbound_id, file_type, file_name, file_path, created_at)
SELECT o.id, 'other', o.attachment_name, o.attachment_path, o.created_at
FROM outbound_order o
WHERE o.attachment_path IS NOT NULL AND o.attachment_path != ''
  AND NOT EXISTS (SELECT 1 FROM outbound_attachment a WHERE a.outbound_id = o.id);
