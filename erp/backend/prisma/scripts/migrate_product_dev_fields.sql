-- 产品开发扩展字段
ALTER TABLE product_dev ADD COLUMN takealot_price_image_url VARCHAR(500) NULL AFTER takealot_url;
ALTER TABLE product_dev ADD COLUMN amazon_url VARCHAR(500) NULL AFTER takealot_price_image_url;
ALTER TABLE product_dev ADD COLUMN alibaba1688_url VARCHAR(500) NULL AFTER amazon_url;
ALTER TABLE product_dev ADD COLUMN alibaba1688_image_url VARCHAR(500) NULL AFTER alibaba1688_url;
ALTER TABLE product_dev ADD COLUMN product_length_cm DECIMAL(8,2) NULL AFTER spec;
ALTER TABLE product_dev ADD COLUMN product_width_cm DECIMAL(8,2) NULL AFTER product_length_cm;
ALTER TABLE product_dev ADD COLUMN product_height_cm DECIMAL(8,2) NULL AFTER product_width_cm;
ALTER TABLE product_dev ADD COLUMN package_length_cm DECIMAL(8,2) NULL AFTER product_height_cm;
ALTER TABLE product_dev ADD COLUMN package_width_cm DECIMAL(8,2) NULL AFTER package_length_cm;
ALTER TABLE product_dev ADD COLUMN package_height_cm DECIMAL(8,2) NULL AFTER package_width_cm;
ALTER TABLE product_dev ADD COLUMN sell_price_rmb DECIMAL(12,2) NULL AFTER market_price;
ALTER TABLE product_dev ADD COLUMN max_sell_price_rmb DECIMAL(12,2) NULL AFTER sell_price_rmb;
ALTER TABLE product_dev ADD COLUMN sea_freight_channel VARCHAR(30) NULL AFTER max_sell_price_rmb;
ALTER TABLE product_dev ADD COLUMN volumetric_weight_kg DECIMAL(10,3) NULL AFTER sea_freight_channel;
ALTER TABLE product_dev ADD COLUMN cbm DECIMAL(10,6) NULL AFTER volumetric_weight_kg;
