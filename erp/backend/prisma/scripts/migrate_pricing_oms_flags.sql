-- 货盘 OMS 可见 / 可下单开关
ALTER TABLE product_pricing ADD COLUMN visible_on_oms TINYINT(1) NOT NULL DEFAULT 0 AFTER oms_sync_at;
ALTER TABLE product_pricing ADD COLUMN orderable_on_oms TINYINT(1) NOT NULL DEFAULT 0 AFTER visible_on_oms;
ALTER TABLE product_pricing ADD COLUMN visible_on_oms_at DATETIME NULL AFTER orderable_on_oms;
ALTER TABLE product_pricing ADD COLUMN orderable_on_oms_at DATETIME NULL AFTER visible_on_oms_at;

-- 已同步 OMS 的历史记录补标为可见
UPDATE product_pricing
SET visible_on_oms = 1,
    visible_on_oms_at = COALESCE(visible_on_oms_at, oms_sync_at, updated_at)
WHERE pricing_status = 'synced';
