-- 将跟进销售为陈琪珍、但归属运营为空的线索，归属运营回填为 chenqizhen（陈琪珍）。
-- 可重复执行（仅更新 assignee_id IS NULL 的记录）。

UPDATE `lead` l
INNER JOIN sys_user u ON u.username = 'chenqizhen' AND u.status = 1
SET l.assignee_id = u.id
WHERE l.assignee_id IS NULL
  AND (
    l.follow_sales LIKE '%陈琪珍%'
    OR l.remark LIKE '%对接:陈琪珍%'
    OR l.remark LIKE '%再对接:陈琪珍%'
  );
