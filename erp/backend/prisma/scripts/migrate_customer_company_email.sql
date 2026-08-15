-- 客户表增加公司与邮箱字段
ALTER TABLE `customer`
  ADD COLUMN `company_name` VARCHAR(200) NULL AFTER `customer_name`,
  ADD COLUMN `contact_email` VARCHAR(120) NULL AFTER `company_name`;
