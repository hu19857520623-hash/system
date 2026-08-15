-- P1：换标/标签按打印（扫码）件数计费
ALTER TABLE outbound_order
  ADD COLUMN relabel_print_count INT NOT NULL DEFAULT 0 COMMENT '换标计费件数(按扫码确认件数)' AFTER relabel_confirmed_at;

ALTER TABLE inbound_order
  ADD COLUMN label_print_count INT NOT NULL DEFAULT 0 COMMENT '入库标签累计打印次数' AFTER remark;
