const INSECURE_SECRET_MARKERS = ['change-me', 'replace-me', '请替换', 'example']

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = String(config.NODE_ENV || 'development')
  const jwtSecret = String(config.JWT_SECRET || '')
  const databaseUrl = String(config.DATABASE_URL || '')

  if (!databaseUrl) {
    throw new Error('数据库连接配置缺失（DATABASE_URL）')
  }

  if (!jwtSecret) {
    throw new Error('登录密钥配置缺失（JWT_SECRET）')
  }

  if (
    nodeEnv === 'production' &&
    (jwtSecret.length < 32 ||
      INSECURE_SECRET_MARKERS.some((marker) => jwtSecret.toLowerCase().includes(marker)))
  ) {
    throw new Error('登录密钥（JWT_SECRET）不合规：须为至少 32 位的非占位密钥')
  }

  return config
}

export function resolveCorsOrigins(value: unknown, nodeEnv: unknown): string[] {
  const configured = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (configured.length) return configured
  if (String(nodeEnv || 'development') === 'production') {
    throw new Error('生产环境必须配置跨域来源（CORS_ORIGINS）')
  }
  return [
    'http://localhost:5180',
    'http://127.0.0.1:5180',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8080',
  ]
}
