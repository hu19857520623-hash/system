-- 安衡测量仪 / WCS 称重联调台
CREATE TABLE IF NOT EXISTS `wcs_weigh_event` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tickets_num` VARCHAR(80) NOT NULL DEFAULT '',
  `weight_kg` VARCHAR(40) NOT NULL DEFAULT '',
  `length_mm` VARCHAR(40) NOT NULL DEFAULT '',
  `width_mm` VARCHAR(40) NOT NULL DEFAULT '',
  `height_mm` VARCHAR(40) NOT NULL DEFAULT '',
  `volume_mm3` VARCHAR(40) NOT NULL DEFAULT '',
  `machine` VARCHAR(80) NOT NULL DEFAULT '',
  `member_no` VARCHAR(80) NULL,
  `warehouse` VARCHAR(80) NULL,
  `goods_name` VARCHAR(200) NULL,
  `goods_num` VARCHAR(40) NULL,
  `express_name` VARCHAR(80) NULL,
  `remarks` VARCHAR(500) NULL,
  `raw_json` JSON NOT NULL,
  `result` VARCHAR(10) NOT NULL,
  `message` VARCHAR(200) NOT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'device',
  `client_ip` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wcs_weigh_created` (`created_at`),
  KEY `idx_wcs_weigh_tickets` (`tickets_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wcs_weigh_photo` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `express_no` VARCHAR(80) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `file_size` INT NOT NULL DEFAULT 0,
  `is_ok` TINYINT NOT NULL DEFAULT 1,
  `source` VARCHAR(20) NOT NULL DEFAULT 'device',
  `client_ip` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wcs_photo_created` (`created_at`),
  KEY `idx_wcs_photo_express` (`express_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wcs_device_config` (
  `id` INT NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `device_key` VARCHAR(80) NULL,
  `chute_message` VARCHAR(80) NOT NULL DEFAULT '',
  `require_member_id` TINYINT(1) NOT NULL DEFAULT 0,
  `print_data` VARCHAR(2000) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `wcs_device_config` (`id`, `enabled`, `chute_message`) VALUES (1, 1, '');

INSERT INTO `sys_permission` (`perm_code`, `perm_name`, `module`) VALUES
  ('anheng.view', '安衡测量仪-查看', 'anheng'),
  ('anheng.test', '安衡测量仪-联调', 'anheng')
ON DUPLICATE KEY UPDATE `perm_name` = VALUES(`perm_name`), `module` = VALUES(`module`);

INSERT IGNORE INTO `sys_role_permission` (`role_code`, `perm_code`)
SELECT roles.role_code, perms.perm_code
FROM (
  SELECT 'admin' AS role_code UNION ALL SELECT 'warehouse' UNION ALL SELECT 'ops_manager'
) roles
CROSS JOIN (
  SELECT 'anheng.view' AS perm_code UNION ALL SELECT 'anheng.test'
) perms;
