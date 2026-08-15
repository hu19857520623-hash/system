-- 物流记录增加仓库 POD 扫码字段
ALTER TABLE `oms_LogisticsRecord`
  ADD COLUMN `podCode` VARCHAR(80) NULL AFTER `podStatus`;
