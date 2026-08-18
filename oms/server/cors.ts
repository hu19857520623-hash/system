const DEV_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5180',
  'http://localhost:5180',
]

export function resolveOmsCorsOrigins(value: unknown, nodeEnv: unknown): string[] | false {
  const configured = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (configured.length) return configured
  if (String(nodeEnv || 'development') === 'production') return false
  return [...DEV_ORIGINS]
}
