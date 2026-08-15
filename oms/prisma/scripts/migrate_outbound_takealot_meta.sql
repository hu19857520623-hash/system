ALTER TABLE oms_OutboundOrder ADD COLUMN sellerStoreName VARCHAR(200) NULL AFTER scheduledDeliveryDate;
ALTER TABLE oms_OutboundOrder ADD COLUMN takealotDestWarehouse VARCHAR(20) NULL AFTER sellerStoreName;
ALTER TABLE oms_OutboundOrder ADD COLUMN takealotSellerId VARCHAR(30) NULL AFTER takealotDestWarehouse;
ALTER TABLE oms_OutboundOrder ADD COLUMN takealotBookingRef VARCHAR(50) NULL AFTER takealotSellerId;
ALTER TABLE oms_OutboundOrder ADD COLUMN shipmentDueDate VARCHAR(40) NULL AFTER takealotBookingRef;
