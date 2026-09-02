-- 把同一系统账号的跟进销售别名收成「姓名(账号)」。
-- 例如 ohhh bys / ohhh bys@微信 → ohhh bys(sky)，陈琪珍(kiki) → 陈琪珍(chenqizhen)。
-- 可重复执行。
SET NAMES utf8mb4;

UPDATE `lead` l
INNER JOIN sys_user u ON u.status = 1
  AND (
    TRIM(l.follow_sales) = TRIM(IFNULL(u.real_name, ''))
    OR TRIM(l.follow_sales) = TRIM(u.username)
    OR TRIM(l.follow_sales) = CONCAT(TRIM(IFNULL(u.real_name, '')), '(', TRIM(u.username), ')')
    OR TRIM(l.follow_sales) = CONCAT(TRIM(IFNULL(u.real_name, '')), '@微信')
    OR TRIM(l.follow_sales) = CONCAT(TRIM(u.username), '@微信')
  )
SET l.follow_sales = LEFT(
  CASE
    WHEN TRIM(IFNULL(u.real_name, '')) <> ''
         AND TRIM(IFNULL(u.username, '')) <> ''
         AND LOWER(TRIM(u.real_name)) <> LOWER(TRIM(u.username))
      THEN CONCAT(TRIM(u.real_name), '(', TRIM(u.username), ')')
    WHEN TRIM(IFNULL(u.real_name, '')) <> '' THEN TRIM(u.real_name)
    ELSE TRIM(u.username)
  END
, 50)
WHERE l.follow_sales IS NOT NULL
  AND TRIM(l.follow_sales) <> ''
  AND l.follow_sales NOT LIKE '%,%'
  AND l.follow_sales NOT LIKE '%，%';

-- 姓名(昵称) 且该姓名只对应一个系统账号时，收成系统账号展示名
UPDATE `lead` l
INNER JOIN sys_user u ON u.status = 1
  AND TRIM(IFNULL(u.real_name, '')) <> ''
  AND TRIM(l.follow_sales) LIKE CONCAT(TRIM(u.real_name), '(%')
  AND RIGHT(TRIM(l.follow_sales), 1) = ')'
INNER JOIN (
  SELECT TRIM(real_name) AS real_name
  FROM sys_user
  WHERE status = 1 AND TRIM(IFNULL(real_name, '')) <> ''
  GROUP BY TRIM(real_name)
  HAVING COUNT(*) = 1
) uniq ON uniq.real_name = TRIM(u.real_name)
SET l.follow_sales = LEFT(
  CASE
    WHEN TRIM(IFNULL(u.real_name, '')) <> ''
         AND TRIM(IFNULL(u.username, '')) <> ''
         AND LOWER(TRIM(u.real_name)) <> LOWER(TRIM(u.username))
      THEN CONCAT(TRIM(u.real_name), '(', TRIM(u.username), ')')
    WHEN TRIM(IFNULL(u.real_name, '')) <> '' THEN TRIM(u.real_name)
    ELSE TRIM(u.username)
  END
, 50)
WHERE l.follow_sales IS NOT NULL
  AND TRIM(l.follow_sales) <> ''
  AND l.follow_sales NOT LIKE '%,%'
  AND l.follow_sales NOT LIKE '%，%';
