-- Linux MySQL: ERP raw SQL uses PascalCase legacy names; OMS Prisma creates lowercase tables.
-- Updatable single-table views restore compatibility until ERP code is deployed.
DROP VIEW IF EXISTS `oms_CustomerAccount`;
DROP VIEW IF EXISTS `oms_BillingAccount`;
DROP VIEW IF EXISTS `oms_PortalUser`;
DROP VIEW IF EXISTS `oms_InventoryItem`;
DROP VIEW IF EXISTS `oms_Product`;
DROP VIEW IF EXISTS `oms_InboundOrder`;

CREATE VIEW `oms_CustomerAccount` AS SELECT * FROM `oms_customeraccount`;
CREATE VIEW `oms_BillingAccount` AS SELECT * FROM `oms_billingaccount`;
CREATE VIEW `oms_PortalUser` AS SELECT * FROM `oms_portaluser`;
CREATE VIEW `oms_InventoryItem` AS SELECT * FROM `oms_inventoryitem`;
CREATE VIEW `oms_Product` AS SELECT * FROM `oms_product`;
CREATE VIEW `oms_InboundOrder` AS SELECT * FROM `oms_inboundorder`;
