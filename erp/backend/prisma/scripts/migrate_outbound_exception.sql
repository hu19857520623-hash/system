-- 出库单异常状态：记录标记异常前的状态，便于解除后恢复
ALTER TABLE outbound_order
  ADD COLUMN exception_from_status VARCHAR(20) NULL COMMENT '标记异常前的状态' AFTER problem_remark;

UPDATE outbound_order
SET exception_from_status = status,
    status = 'exception'
WHERE is_problem = 1
  AND status NOT IN ('cancelled', 'shipped', 'delivered', 'exception');
