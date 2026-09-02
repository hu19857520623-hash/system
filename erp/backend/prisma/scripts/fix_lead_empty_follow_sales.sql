-- 把「跟进中但跟进销售为空」的历史脏数据，按归属运营（或最近跟进操作人）回填跟进销售。
-- 不回填「新线索」，避免刚建的线索还没跟进就被写成销售名。
-- 可重复执行。
SET NAMES utf8mb4;

UPDATE `lead` l
INNER JOIN sys_user u ON u.id = l.assignee_id
SET l.follow_sales = LEFT(
  CASE
    WHEN TRIM(IFNULL(u.real_name, '')) <> ''
         AND TRIM(IFNULL(u.username, '')) <> ''
         AND TRIM(u.real_name) <> TRIM(u.username)
      THEN CONCAT(TRIM(u.real_name), '(', TRIM(u.username), ')')
    WHEN TRIM(IFNULL(u.real_name, '')) <> '' THEN TRIM(u.real_name)
    ELSE TRIM(u.username)
  END
, 50)
WHERE (l.follow_sales IS NULL OR TRIM(l.follow_sales) = '')
  AND l.assignee_id IS NOT NULL
  AND l.status IN ('following', 'hot', 'nurture');

UPDATE `lead` l
INNER JOIN (
  SELECT fu.lead_id, fu.operator_id
  FROM lead_follow_up fu
  INNER JOIN (
    SELECT lead_id, MAX(id) AS max_id
    FROM lead_follow_up
    GROUP BY lead_id
  ) latest ON latest.lead_id = fu.lead_id AND latest.max_id = fu.id
) last_fu ON last_fu.lead_id = l.id
INNER JOIN sys_user u ON u.id = last_fu.operator_id
SET l.follow_sales = LEFT(
  CASE
    WHEN TRIM(IFNULL(u.real_name, '')) <> ''
         AND TRIM(IFNULL(u.username, '')) <> ''
         AND TRIM(u.real_name) <> TRIM(u.username)
      THEN CONCAT(TRIM(u.real_name), '(', TRIM(u.username), ')')
    WHEN TRIM(IFNULL(u.real_name, '')) <> '' THEN TRIM(u.real_name)
    ELSE TRIM(u.username)
  END
, 50)
WHERE (l.follow_sales IS NULL OR TRIM(l.follow_sales) = '')
  AND last_fu.operator_id IS NOT NULL
  AND l.status IN ('following', 'hot', 'nurture');
