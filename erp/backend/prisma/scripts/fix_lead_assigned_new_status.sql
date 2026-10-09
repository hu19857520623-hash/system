-- 将已有跟进销售的新线索转为跟进中，不生成虚假的跟进记录。可重复执行。
SET NAMES utf8mb4;

UPDATE `lead`
SET status = 'following'
WHERE status = 'new'
  AND (
    TRIM(IFNULL(follow_sales, '')) <> ''
    OR TRIM(SUBSTRING_INDEX(IFNULL(REGEXP_SUBSTR(remark, '再对接:[^|]+'), ''), ':', -1)) <> ''
    OR TRIM(SUBSTRING_INDEX(IFNULL(REGEXP_SUBSTR(remark, '(?<!再)对接:[^|]+'), ''), ':', -1)) <> ''
  );
