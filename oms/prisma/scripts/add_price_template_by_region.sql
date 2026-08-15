-- 价格模板按收货地区拆分 + 客户按地区绑定（MySQL）

ALTER TABLE `oms_CustomerAccount`
  ADD COLUMN `priceTemplateByRegion` TEXT NULL COMMENT 'JSON: { jhb, cpt, dbn }' AFTER `priceTemplateId`;

ALTER TABLE `oms_PriceTemplate`
  ADD COLUMN `regionCode` VARCHAR(50) NOT NULL DEFAULT 'jhb' AFTER `name`;

-- 旧综合模板迁移为 JHB 模板（可按需手工调整 CPT/DBN 模板）
UPDATE `oms_PriceTemplate` SET `regionCode` = 'jhb' WHERE `id` LIKE '%jhb%' OR `id` IN ('pt-jhb-default', 'pt-vip');
UPDATE `oms_PriceTemplate` SET `regionCode` = 'cpt' WHERE `id` LIKE '%cpt%';
UPDATE `oms_PriceTemplate` SET `regionCode` = 'dbn' WHERE `id` LIKE '%dbn%';
