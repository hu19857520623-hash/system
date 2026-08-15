ALTER TABLE outbound_order ADD COLUMN seller_store_name VARCHAR(200) NULL AFTER fba_no;
ALTER TABLE outbound_order ADD COLUMN takealot_seller_id VARCHAR(30) NULL AFTER seller_store_name;
ALTER TABLE outbound_order ADD COLUMN takealot_booking_ref VARCHAR(50) NULL AFTER takealot_seller_id;
ALTER TABLE outbound_order ADD COLUMN shipment_due_date DATE NULL AFTER takealot_booking_ref;
