-- 批次库存：同库位按入库单拆批，并记下该票货的采购/海运成本。可重复执行。

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_order_item' AND COLUMN_NAME = 'cost_rmb'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inbound_order_item`
    ADD COLUMN `cost_rmb` DECIMAL(12,2) NULL AFTER `remark`,
    ADD COLUMN `sea_freight_per_unit` DECIMAL(12,4) NULL AFTER `cost_rmb`,
    ADD COLUMN `domestic_fee_per_unit` DECIMAL(12,4) NULL AFTER `sea_freight_per_unit`',
  'SELECT 1');
PREPARE inbound_item_cost_stmt FROM @sql;
EXECUTE inbound_item_cost_stmt;
DEALLOCATE PREPARE inbound_item_cost_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_location' AND COLUMN_NAME = 'cost_rmb'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `inventory_location`
    ADD COLUMN `cost_rmb` DECIMAL(12,2) NULL AFTER `inbound_no`,
    ADD COLUMN `sea_freight_per_unit` DECIMAL(12,4) NULL AFTER `cost_rmb`,
    ADD COLUMN `domestic_fee_per_unit` DECIMAL(12,4) NULL AFTER `sea_freight_per_unit`,
    ADD COLUMN `unit_cost_rmb` DECIMAL(12,2) NULL AFTER `domestic_fee_per_unit`,
    ADD COLUMN `received_at` DATETIME(3) NULL AFTER `unit_cost_rmb`',
  'SELECT 1');
PREPARE loc_cost_stmt FROM @sql;
EXECUTE loc_cost_stmt;
DEALLOCATE PREPARE loc_cost_stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_pick_allocation' AND COLUMN_NAME = 'inbound_no'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `outbound_pick_allocation`
    ADD COLUMN `inbound_no` VARCHAR(30) NULL AFTER `qty`,
    ADD COLUMN `batch_no` VARCHAR(50) NULL AFTER `inbound_no`,
    ADD COLUMN `cost_rmb` DECIMAL(12,2) NULL AFTER `batch_no`,
    ADD COLUMN `sea_freight_per_unit` DECIMAL(12,4) NULL AFTER `cost_rmb`,
    ADD COLUMN `domestic_fee_per_unit` DECIMAL(12,4) NULL AFTER `sea_freight_per_unit`,
    ADD COLUMN `unit_cost_rmb` DECIMAL(12,2) NULL AFTER `domestic_fee_per_unit`',
  'SELECT 1');
PREPARE pick_cost_stmt FROM @sql;
EXECUTE pick_cost_stmt;
DEALLOCATE PREPARE pick_cost_stmt;

UPDATE `inventory_location`
SET `batch_no` = `inbound_no`
WHERE (`batch_no` IS NULL OR TRIM(`batch_no`) = '')
  AND `inbound_no` IS NOT NULL
  AND TRIM(`inbound_no`) <> '';

UPDATE `inventory_location`
SET `batch_no` = CONCAT('OPENING-', `id`)
WHERE `batch_no` IS NULL OR TRIM(`batch_no`) = '';

UPDATE `inventory_location` loc
INNER JOIN `product` p ON p.id = loc.product_id
SET
  loc.cost_rmb = IFNULL(loc.cost_rmb, IFNULL(p.cost_rmb, 0)),
  loc.sea_freight_per_unit = IFNULL(loc.sea_freight_per_unit, IFNULL(p.sea_freight_per_unit, 0)),
  loc.domestic_fee_per_unit = IFNULL(loc.domestic_fee_per_unit, IFNULL(p.domestic_fee_per_unit, 0)),
  loc.unit_cost_rmb = IFNULL(
    loc.unit_cost_rmb,
    ROUND(IFNULL(p.cost_rmb, 0) + IFNULL(p.sea_freight_per_unit, 0) + IFNULL(p.domestic_fee_per_unit, 0), 2)
  )
WHERE loc.unit_cost_rmb IS NULL;

UPDATE `inventory` inv
INNER JOIN (
  SELECT product_id, warehouse_code,
    ROUND(SUM(qty * IFNULL(unit_cost_rmb, 0)) / NULLIF(SUM(qty), 0), 2) AS avg_cost
  FROM `inventory_location`
  WHERE qty > 0
  GROUP BY product_id, warehouse_code
) lot ON lot.product_id = inv.product_id AND lot.warehouse_code = inv.warehouse_code
SET inv.avg_cost_rmb = lot.avg_cost;
