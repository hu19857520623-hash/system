-- 新建供应商默认现结；已有记录保持原结算方式不变。
ALTER TABLE supplier MODIFY COLUMN payment_terms VARCHAR(100) NULL DEFAULT _utf8mb4 0xE78EB0E7BB93;
