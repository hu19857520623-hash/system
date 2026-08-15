-- 入库状态机迁移：三系统(WMS推送) → 两系统(ERP内部确认写库存)
-- 执行前请备份 inbound_order 表

UPDATE inbound_order SET status = 'pending_receipt'
  WHERE status IN ('pending_push', 'push_failed', 'pushed');

-- confirmed 保持不变；后续 1.4 上架阶段可再迁移为 completed
