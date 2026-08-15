-- 公告发布渠道：erp=内部 ERP 工作台，oms=同步至 OMS
ALTER TABLE announcement
  ADD COLUMN target_channel VARCHAR(10) NOT NULL DEFAULT 'erp' COMMENT 'erp/oms';

UPDATE announcement SET target_channel = 'erp' WHERE target_channel IS NULL OR target_channel = '';
