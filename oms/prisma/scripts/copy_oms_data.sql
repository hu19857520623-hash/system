-- Copy OMS data from legacy takealot_oms into takealot_erp.oms_* tables.
-- Run against MySQL after create_oms_tables.sql.

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE takealot_erp.oms_BillingAccount;
TRUNCATE TABLE takealot_erp.oms_StoreAccount;
TRUNCATE TABLE takealot_erp.oms_Product;
TRUNCATE TABLE takealot_erp.oms_InventoryItem;
TRUNCATE TABLE takealot_erp.oms_Order;
TRUNCATE TABLE takealot_erp.oms_InboundOrder;
TRUNCATE TABLE takealot_erp.oms_OutboundOrder;
TRUNCATE TABLE takealot_erp.oms_PlatformSkuMapping;
TRUNCATE TABLE takealot_erp.oms_FeeRecord;
TRUNCATE TABLE takealot_erp.oms_CodeMapping;
TRUNCATE TABLE takealot_erp.oms_LogisticsRecord;
TRUNCATE TABLE takealot_erp.oms_QcReport;
TRUNCATE TABLE takealot_erp.oms_SystemMessage;
TRUNCATE TABLE takealot_erp.oms_Announcement;
TRUNCATE TABLE takealot_erp.oms_PriceTemplate;
TRUNCATE TABLE takealot_erp.oms_StorageRentTemplate;
TRUNCATE TABLE takealot_erp.oms_RegionDispatchRule;
TRUNCATE TABLE takealot_erp.oms_CatalogPurchase;
TRUNCATE TABLE takealot_erp.oms_PaymentMethod;
TRUNCATE TABLE takealot_erp.oms_CustomerAccount;

INSERT INTO takealot_erp.oms_CustomerAccount SELECT * FROM takealot_oms.CustomerAccount;
INSERT INTO takealot_erp.oms_BillingAccount SELECT * FROM takealot_oms.BillingAccount;
INSERT INTO takealot_erp.oms_FeeRecord SELECT * FROM takealot_oms.FeeRecord;
INSERT INTO takealot_erp.oms_StoreAccount SELECT * FROM takealot_oms.StoreAccount;
INSERT INTO takealot_erp.oms_Product SELECT * FROM takealot_oms.Product;
INSERT INTO takealot_erp.oms_InventoryItem SELECT * FROM takealot_oms.InventoryItem;
INSERT INTO takealot_erp.oms_Order SELECT * FROM takealot_oms.Order;
INSERT INTO takealot_erp.oms_InboundOrder SELECT * FROM takealot_oms.InboundOrder;
INSERT INTO takealot_erp.oms_OutboundOrder SELECT * FROM takealot_oms.OutboundOrder;
INSERT INTO takealot_erp.oms_CodeMapping SELECT * FROM takealot_oms.CodeMapping;
INSERT INTO takealot_erp.oms_PlatformSkuMapping SELECT * FROM takealot_oms.PlatformSkuMapping;
INSERT INTO takealot_erp.oms_LogisticsRecord SELECT * FROM takealot_oms.LogisticsRecord;
INSERT INTO takealot_erp.oms_QcReport SELECT * FROM takealot_oms.QcReport;
INSERT INTO takealot_erp.oms_SystemMessage SELECT * FROM takealot_oms.SystemMessage;
INSERT INTO takealot_erp.oms_Announcement SELECT * FROM takealot_oms.Announcement;
INSERT INTO takealot_erp.oms_PriceTemplate SELECT * FROM takealot_oms.PriceTemplate;
INSERT INTO takealot_erp.oms_StorageRentTemplate SELECT * FROM takealot_oms.StorageRentTemplate;
INSERT INTO takealot_erp.oms_RegionDispatchRule SELECT * FROM takealot_oms.RegionDispatchRule;
INSERT INTO takealot_erp.oms_CatalogPurchase SELECT * FROM takealot_oms.CatalogPurchase;
INSERT INTO takealot_erp.oms_PaymentMethod SELECT * FROM takealot_oms.PaymentMethod;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'oms_CustomerAccount' AS tbl, COUNT(*) AS cnt FROM takealot_erp.oms_CustomerAccount
UNION ALL SELECT 'oms_Product', COUNT(*) FROM takealot_erp.oms_Product
UNION ALL SELECT 'oms_FeeRecord', COUNT(*) FROM takealot_erp.oms_FeeRecord
UNION ALL SELECT 'oms_InboundOrder', COUNT(*) FROM takealot_erp.oms_InboundOrder;
