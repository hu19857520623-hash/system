const INSECURE_SECRET_MARKERS = ['change-me', 'replace-me', '请替换', 'example']

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = String(config.NODE_ENV || 'development')
  const jwtSecret = String(config.JWT_SECRET || '')
  const databaseUrl = String(config.DATABASE_URL || '')

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required')
  }

  if (
    nodeEnv === 'production' &&
    (jwtSecret.length < 32 ||
      INSECURE_SECRET_MARKERS.some((marker) => jwtSecret.toLowerCase().includes(marker)))
  ) {
    throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 characters')
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
    throw new Error('CORS_ORIGINS is required in production')
  }
  return ['http://localhost:5173', 'http://localhost:8080']
}
