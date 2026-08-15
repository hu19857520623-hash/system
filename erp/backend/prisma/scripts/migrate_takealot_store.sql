-- Takealot 店铺监控：店铺槽位与 API Key 配置
CREATE TABLE IF NOT EXISTS takealot_store (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  slot TINYINT NOT NULL COMMENT '店铺槽位 0-9',
  store_name VARCHAR(100) NOT NULL,
  coach_role VARCHAR(20) NOT NULL COMMENT 'coach1 / coach2',
  api_key VARCHAR(500) NULL,
  takealot_seller_id BIGINT NULL,
  display_name VARCHAR(200) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_takealot_store_slot (slot),
  INDEX idx_takealot_store_coach (coach_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Takealot 店铺监控配置';
