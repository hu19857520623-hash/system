import { resolveCorsOrigins, validateEnvironment } from './environment'

describe('environment validation', () => {
  it('requires database and JWT configuration', () => {
    expect(() => validateEnvironment({ JWT_SECRET: 'x' })).toThrow('DATABASE_URL')
    expect(() => validateEnvironment({ DATABASE_URL: 'mysql://local' })).toThrow('JWT_SECRET')
  })

  it('rejects placeholder production secrets', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://local',
        JWT_SECRET: 'replace-me-with-a-production-secret',
      }),
    ).toThrow('JWT_SECRET')
  })

  it('allows a strong production secret', () => {
    const config = {
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://local',
      JWT_SECRET: 'a-secure-random-production-value-1234567890',
    }
    expect(validateEnvironment(config)).toBe(config)
  })

  it('requires explicit production CORS origins', () => {
    expect(() => resolveCorsOrigins(undefined, 'production')).toThrow('CORS_ORIGINS')
    expect(resolveCorsOrigins('https://erp.example.com, https://admin.example.com', 'production'))
      .toEqual(['https://erp.example.com', 'https://admin.example.com'])
  })
})
