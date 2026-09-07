-- 将 OMS 客户 portal 登录名迁移为联系电话（纯数字）。
-- 不修改 sys_admin（如 omsadmin）及无 customerId 的内部账号。
-- 执行前请备份 oms_portaluser / oms_customeraccount。

-- 1) 无冲突：直接改为 contactPhone 去非数字
UPDATE `oms_portaluser` u
INNER JOIN `oms_customeraccount` c ON c.id = u.customerId
SET u.username = REGEXP_REPLACE(c.contactPhone, '[^0-9]', ''),
    u.updatedAt = UTC_TIMESTAMP(3)
WHERE u.role <> 'sys_admin'
  AND u.customerId IS NOT NULL
  AND c.contactPhone IS NOT NULL
  AND CHAR_LENGTH(REGEXP_REPLACE(c.contactPhone, '[^0-9]', '')) >= 6
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT `id`, `username`
      FROM `oms_portaluser`
    ) u2
    WHERE u2.username = REGEXP_REPLACE(c.contactPhone, '[^0-9]', '')
      AND u2.id <> u.id
  );

-- 2) 仍有字母等非纯数字登录名：使用 手机号+客户代码 后缀（与 resolveAvailablePortalUsername 一致）
UPDATE `oms_portaluser` u
INNER JOIN `oms_customeraccount` c ON c.id = u.customerId
SET u.username = CONCAT(
      REGEXP_REPLACE(c.contactPhone, '[^0-9]', ''),
      LOWER(REGEXP_REPLACE(c.code, '[^a-zA-Z0-9._-]', ''))
    ),
    u.updatedAt = UTC_TIMESTAMP(3)
WHERE u.role <> 'sys_admin'
  AND u.customerId IS NOT NULL
  AND c.contactPhone IS NOT NULL
  AND CHAR_LENGTH(REGEXP_REPLACE(c.contactPhone, '[^0-9]', '')) >= 6
  AND u.username REGEXP '[a-zA-Z]'
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT `id`, `username`
      FROM `oms_portaluser`
    ) u2
    WHERE u2.username = CONCAT(
      REGEXP_REPLACE(c.contactPhone, '[^0-9]', ''),
      LOWER(REGEXP_REPLACE(c.code, '[^a-zA-Z0-9._-]', ''))
    )
      AND u2.id <> u.id
  );

-- 3) 抽样核对（执行后手动查看）
-- SELECT u.id, u.username, u.role, c.code, c.contactPhone
-- FROM oms_portaluser u
-- LEFT JOIN oms_customeraccount c ON c.id = u.customerId
-- WHERE u.role <> 'sys_admin'
-- ORDER BY c.code;
