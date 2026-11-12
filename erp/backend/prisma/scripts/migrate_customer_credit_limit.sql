-- Credit does not change the balance or create a recharge. Existing customers remain prepaid.
ALTER TABLE customer ADD COLUMN credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0;
