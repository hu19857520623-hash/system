-- 成交客户资料：每次成交可多次上传附件
CREATE TABLE IF NOT EXISTS lead_deal_attachment (
  id BIGINT NOT NULL AUTO_INCREMENT,
  deal_id BIGINT NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_deal_att_deal (deal_id),
  CONSTRAINT fk_lead_deal_att_deal FOREIGN KEY (deal_id) REFERENCES lead_deal (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
