-- 批量去掉线索 remark 中的导入前缀（留资/前端/获客/对接/再对接/销售情况）及 leading「备注:」。
-- 依赖 MySQL 8 REGEXP_REPLACE。可重复执行。

UPDATE `lead`
SET remark = NULLIF(
  TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        remark,
        '^(\\s*(?:留资|前端|获客|对接|再对接|销售情况):[^|]*\\s*(?:\\|\\s*)?)+',
        ''
      ),
      '^备注:\\s*',
      ''
    )
  ),
  ''
)
WHERE remark IS NOT NULL
  AND remark LIKE '留资:%';
