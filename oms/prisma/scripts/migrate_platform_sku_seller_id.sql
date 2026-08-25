-- PlatformSkuMapping 增加 Takealot Seller ID，供预约发货快速绑定后跨页识别
ALTER TABLE oms_PlatformSkuMapping
  ADD COLUMN sellerId VARCHAR(100) NULL AFTER customerId;
