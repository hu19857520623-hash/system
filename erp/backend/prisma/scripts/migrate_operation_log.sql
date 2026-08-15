CREATE TABLE IF NOT EXISTS operation_log (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    operator_id     BIGINT,
    operator_name   VARCHAR(50),
    module          VARCHAR(30)  NOT NULL,
    action          VARCHAR(30)  NOT NULL,
    target_type     VARCHAR(30),
    target_id       VARCHAR(50),
    detail          JSON,
    ip_address      VARCHAR(50),
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_oplog_operator (operator_id),
    INDEX idx_oplog_module (module),
    INDEX idx_oplog_time (created_at)
) ENGINE=InnoDB COMMENT='操作日志';
