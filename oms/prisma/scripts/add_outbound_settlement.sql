-- P6-3：出库对账字段（oms_OutboundOrder）— 逐列添加，可重复执行前请先检查
ALTER TABLE `oms_OutboundOrder` ADD COLUMN `actualFeesTotal` DOUBLE NULL;
ALTER TABLE `oms_OutboundOrder` ADD COLUMN `settlementDelta` DOUBLE NULL;
ALTER TABLE `oms_OutboundOrder` ADD COLUMN `settlementStatus` VARCHAR(30) NULL;
ALTER TABLE `oms_OutboundOrder` ADD COLUMN `measuredVolumeM3` DOUBLE NULL;
ALTER TABLE `oms_OutboundOrder` ADD COLUMN `measuredWeightKg` DOUBLE NULL;
