-- Takealot 平台目的仓配置（账单筛选、出库 fbaWarehouse、OMS 目的仓下拉）

CREATE TABLE IF NOT EXISTS `takealot_dest_warehouse` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(20) NOT NULL,
  `oms_warehouse_id` VARCHAR(20) NULL,
  `label` VARCHAR(80) NOT NULL,
  `city` VARCHAR(50) NULL,
  `match_aliases` TEXT NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_takealot_dest_code` (`code`),
  KEY `idx_takealot_dest_enabled_sort` (`enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Takealot 平台目的仓配置';

INSERT INTO `takealot_dest_warehouse` (`code`, `oms_warehouse_id`, `label`, `city`, `match_aliases`, `enabled`, `sort_order`)
SELECT * FROM (
  SELECT 'JHB' AS code, NULL AS oms_warehouse_id, 'JHB' AS label, '约翰内斯堡' AS city, '["JHB"]' AS match_aliases, 1 AS enabled, 10 AS sort_order
  UNION ALL SELECT 'JHB1', 'jhb1', 'JHB1', '约翰内斯堡', '["JHB1"]', 1, 20
  UNION ALL SELECT 'JHB3', 'jhb3', 'JHB3', '约翰内斯堡', '["JHB3","JHB"]', 1, 30
  UNION ALL SELECT 'CPT1', 'cpt1', 'CPT1', '开普敦', '["CPT1","CPT"]', 1, 40
  UNION ALL SELECT 'CPT2', 'cpt2', 'CPT2', '开普敦', '["CPT2"]', 1, 50
  UNION ALL SELECT 'DBN', 'dbn', 'DBN', '德班', '["DBN","DBN1"]', 1, 60
  UNION ALL SELECT 'DBN1', 'dbn', 'DBN1', '德班', '["DBN1"]', 1, 70
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `takealot_dest_warehouse` LIMIT 1);
