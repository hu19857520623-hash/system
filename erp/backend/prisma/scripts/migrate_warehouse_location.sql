-- 1A: 库位主数据 + 入库扩展字段
-- 执行前请备份数据库

CREATE TABLE IF NOT EXISTS warehouse_zone (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  zone_code     VARCHAR(30)  NOT NULL,
  zone_name     VARCHAR(100) NOT NULL,
  warehouse_code VARCHAR(30) NOT NULL,
  zone_type     VARCHAR(20)  NOT NULL DEFAULT 'storage',
  status        TINYINT      NOT NULL DEFAULT 1,
  remark        VARCHAR(500) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_zone_wh (warehouse_code, zone_code),
  KEY idx_zone_wh (warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_location (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  location_code  VARCHAR(30)  NOT NULL,
  warehouse_code VARCHAR(30)  NOT NULL,
  zone_id        BIGINT       NOT NULL,
  aisle          VARCHAR(10)  NULL,
  rack           VARCHAR(10)  NULL,
  level          VARCHAR(10)  NULL,
  bin            VARCHAR(10)  NULL,
  max_volume_cbm DECIMAL(10,4) NULL,
  max_weight_kg  DECIMAL(10,2) NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'available',
  remark         VARCHAR(500) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_loc_wh (warehouse_code, location_code),
  KEY idx_loc_zone (zone_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_location (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  product_id     BIGINT       NOT NULL,
  sku            VARCHAR(30)  NOT NULL,
  warehouse_code VARCHAR(30)  NOT NULL,
  location_id    BIGINT       NOT NULL,
  location_code  VARCHAR(30)  NOT NULL,
  qty            INT          NOT NULL DEFAULT 0,
  batch_no       VARCHAR(50)  NULL,
  inbound_no     VARCHAR(30)  NULL,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_inv_loc (product_id, location_id, batch_no),
  KEY idx_inv_loc_sku (sku, warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inbound_putaway_item (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  inbound_id      BIGINT       NOT NULL,
  inbound_item_id BIGINT       NOT NULL,
  location_id     BIGINT       NOT NULL,
  location_code   VARCHAR(30)  NOT NULL,
  qty             INT          NOT NULL,
  operator_id     BIGINT       NULL,
  putaway_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_putaway_inbound (inbound_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- inbound_order 扩展（若列已存在会报错，可逐条跳过）
ALTER TABLE inbound_order ADD COLUMN received_at DATETIME NULL AFTER push_wms_at;
ALTER TABLE inbound_order ADD COLUMN received_by BIGINT NULL AFTER received_at;
ALTER TABLE inbound_order ADD COLUMN qc_at DATETIME NULL AFTER received_by;
ALTER TABLE inbound_order ADD COLUMN qc_by BIGINT NULL AFTER qc_at;
ALTER TABLE inbound_order ADD COLUMN putaway_at DATETIME NULL AFTER qc_by;
ALTER TABLE inbound_order ADD COLUMN putaway_by BIGINT NULL AFTER putaway_at;

ALTER TABLE inbound_order_item ADD COLUMN qc_status VARCHAR(20) NULL DEFAULT 'pending' AFTER diff_qty;
ALTER TABLE inbound_order_item ADD COLUMN qc_remark VARCHAR(500) NULL AFTER qc_status;
ALTER TABLE inbound_order_item ADD COLUMN putaway_qty INT NULL DEFAULT 0 AFTER qc_remark;
