-- 公告定时发布与有效期
ALTER TABLE announcement
  ADD COLUMN scheduled_at DATETIME NULL COMMENT '计划发布时间' AFTER published_at,
  ADD COLUMN expires_at DATETIME NULL COMMENT '公告失效时间' AFTER scheduled_at;

UPDATE announcement
SET scheduled_at = published_at
WHERE status = 'scheduled' AND scheduled_at IS NULL AND published_at IS NOT NULL;
