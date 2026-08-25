-- 入库扫箱收货：人工清点实收箱数
ALTER TABLE inbound_order
  ADD COLUMN received_carton_count INT NULL COMMENT '实收箱数（扫箱收货人工清点）' AFTER label_print_count;
