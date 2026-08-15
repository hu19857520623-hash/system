-- OMS：平台货盘客户 TKL
INSERT INTO `oms_CustomerAccount` (
  `id`, `name`, `code`, `type`, `contact`, `email`, `status`, `permissions`, `warehouse`, `createdAt`, `lastLoginAt`, `priceTemplateId`
)
SELECT
  'tkl', '平台货盘', 'TKL', 'catalog', '系统', 'catalog@platform.local', 'active',
  '["dashboard:read","catalog:read","inventory:read"]',
  'jhb1', '2025-01-01', '—', 'pt-jhb-default'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `oms_CustomerAccount` WHERE `code` = 'TKL');
