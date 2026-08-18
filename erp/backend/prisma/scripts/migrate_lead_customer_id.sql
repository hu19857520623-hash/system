-- 线索转 ERP/OMS 客户后回写客户 ID
ALTER TABLE `lead`
  ADD COLUMN `customer_id` BIGINT NULL AFTER `remark`,
  ADD INDEX `idx_lead_customer` (`customer_id`);
