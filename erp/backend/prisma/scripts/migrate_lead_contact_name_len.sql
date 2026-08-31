-- 线索联系方式加长，容纳微信 ID / 备注型联系方式
ALTER TABLE `lead`
  MODIFY COLUMN `contact_name` VARCHAR(100) NULL;
