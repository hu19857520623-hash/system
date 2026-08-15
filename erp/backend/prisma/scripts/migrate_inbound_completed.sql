-- 入库状态 completed 迁移
UPDATE inbound_order SET status = 'completed' WHERE status = 'confirmed';
