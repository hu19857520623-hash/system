-- 入库单记录始发物流中转仓，创建时扣减该仓可用库存
ALTER TABLE inbound_order
  ADD COLUMN source_warehouse_code VARCHAR(30) NULL COMMENT '始发物流中转仓' AFTER po_id;
