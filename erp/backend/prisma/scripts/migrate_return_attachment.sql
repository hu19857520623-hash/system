-- 退件附件表（ERP）
CREATE TABLE IF NOT EXISTS return_attachment (
  id BIGINT NOT NULL AUTO_INCREMENT,
  return_id BIGINT NOT NULL,
  file_type VARCHAR(30) NOT NULL DEFAULT 'return_doc',
  file_name VARCHAR(200) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_return_att_return (return_id),
  CONSTRAINT fk_return_att_return FOREIGN KEY (return_id) REFERENCES return_order (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE oms_ReturnOrder
  ADD COLUMN attachments TEXT NULL AFTER remark;
