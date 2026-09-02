-- 回填 assignee_id 为空的历史线索归属运营（可重复执行，仅更新 assignee_id IS NULL）。
-- 规则：创建时确定的归属运营不因再次跟进/退回线索池而丢失；本脚本用于修复旧 bug 清空的记录。
SET NAMES utf8mb4;

-- 1) 按导入备注「获客:」还原归属运营（与历史导入规则一致）
UPDATE `lead` l
INNER JOIN sys_user u ON u.username = 'caiyun' AND u.status = 1
SET l.assignee_id = u.id
WHERE l.assignee_id IS NULL
  AND l.remark IS NOT NULL
  AND (l.remark LIKE '%获客:尚彩云%' OR l.remark LIKE '%获客:彩云%');

UPDATE `lead` l
INNER JOIN sys_user u ON u.username = 'chenqizhen' AND u.status = 1
SET l.assignee_id = u.id
WHERE l.assignee_id IS NULL
  AND l.remark IS NOT NULL
  AND (l.remark LIKE '%获客:李靖%' OR l.remark LIKE '%获客:陈%');

UPDATE `lead` l
INNER JOIN sys_user u ON u.username = 'sky' AND u.status = 1
SET l.assignee_id = u.id
WHERE l.assignee_id IS NULL
  AND l.remark IS NOT NULL
  AND l.remark LIKE '%获客:心怡%';

UPDATE `lead` l
INNER JOIN sys_user u ON u.username = 'hetong' AND u.status = 1
SET l.assignee_id = u.id
WHERE l.assignee_id IS NULL
  AND l.remark IS NOT NULL
  AND l.remark LIKE '%获客:何桐%';

-- 仍有「获客:」但未命中上表时，默认归属 ohhh bys（与历史一次性修复一致）
UPDATE `lead` l
INNER JOIN sys_user u ON u.username = 'sky' AND u.status = 1
SET l.assignee_id = u.id
WHERE l.assignee_id IS NULL
  AND l.remark IS NOT NULL
  AND l.remark LIKE '%获客:%';

-- 2) 无获客备注时：取最早一条 cs / sales_manager 跟进操作人作为归属运营
UPDATE `lead` l
INNER JOIN (
  SELECT fu.lead_id, fu.operator_id
  FROM lead_follow_up fu
  INNER JOIN (
    SELECT fu2.lead_id, MIN(fu2.id) AS min_id
    FROM lead_follow_up fu2
    INNER JOIN sys_user u2 ON u2.id = fu2.operator_id
    WHERE fu2.operator_id IS NOT NULL
      AND u2.status = 1
      AND u2.role_code IN ('cs', 'sales_manager')
    GROUP BY fu2.lead_id
  ) first_cs ON first_cs.lead_id = fu.lead_id AND first_cs.min_id = fu.id
) src ON src.lead_id = l.id
SET l.assignee_id = src.operator_id
WHERE l.assignee_id IS NULL;
