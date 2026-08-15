ALTER TABLE `oms_OutboundOrder`
  ADD COLUMN `destRegion` VARCHAR(50) NULL AFTER `preDeductFees`,
  ADD COLUMN `priceTemplateId` VARCHAR(50) NULL AFTER `destRegion`,
  ADD COLUMN `priceTemplateName` VARCHAR(200) NULL AFTER `priceTemplateId`,
  ADD COLUMN `preDeductTotal` DOUBLE NULL AFTER `priceTemplateName`,
  ADD COLUMN `preDeductVolumeM3` DOUBLE NULL AFTER `preDeductTotal`,
  ADD COLUMN `preDeductWeightKg` DOUBLE NULL AFTER `preDeductVolumeM3`,
  ADD COLUMN `preDeductSnapshot` TEXT NULL AFTER `preDeductWeightKg`,
  ADD COLUMN `measureSnapshot` TEXT NULL AFTER `preDeductSnapshot`,
  ADD COLUMN `actualFeesSnapshot` TEXT NULL AFTER `measureSnapshot`,
  ADD COLUMN `recipient` TEXT NULL AFTER `actualFeesSnapshot`;
