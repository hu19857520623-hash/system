-- 线索增加跟进销售，并从导入备注回填（再对接优先，否则对接）
ALTER TABLE `lead`
  ADD COLUMN `follow_sales` VARCHAR(50) NULL AFTER `assignee_id`,
  ADD INDEX `idx_lead_follow_sales` (`follow_sales`);

UPDATE `lead`
SET follow_sales = TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(remark, '再对接:', -1), ' |', 1))
WHERE remark LIKE '%再对接:%'
  AND (follow_sales IS NULL OR follow_sales = '');

UPDATE `lead`
SET follow_sales = TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(remark, '对接:', -1), ' |', 1))
WHERE remark LIKE '%对接:%'
  AND remark NOT LIKE '%再对接:%'
  AND (follow_sales IS NULL OR follow_sales = '');
