import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBootstrapCredentials } from './bootstrap-admin.js'

const KEYS = [
  'OMS_PORTAL_ADMIN_USERNAME',
  'OMS_BOOTSTRAP_ADMIN_USERNAME',
  'OMS_PORTAL_ADMIN_EMAIL',
  'OMS_BOOTSTRAP_ADMIN_EMAIL',
  'OMS_PORTAL_ADMIN_PASSWORD',
  'OMS_BOOTSTRAP_ADMIN_PASSWORD',
  'OMS_ALLOW_INSECURE_DEV_AUTH',
  'NODE_ENV',
] as const

function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, run: () => void) {
  const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
  for (const key of KEYS) {
    const next = values[key]
    if (next === undefined) delete process.env[key]
    else process.env[key] = next
  }
  try {
    run()
  } finally {
    for (const key of KEYS) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('returns null when neither username nor password is configured', () => {
  withEnv({
    NODE_ENV: 'production',
    OMS_ALLOW_INSECURE_DEV_AUTH: undefined,
    OMS_BOOTSTRAP_ADMIN_USERNAME: undefined,
    OMS_BOOTSTRAP_ADMIN_PASSWORD: undefined,
    OMS_PORTAL_ADMIN_USERNAME: undefined,
    OMS_PORTAL_ADMIN_PASSWORD: undefined,
    OMS_PORTAL_ADMIN_EMAIL: undefined,
    OMS_BOOTSTRAP_ADMIN_EMAIL: undefined,
  }, () => {
    assert.equal(resolveBootstrapCredentials(), null)
  })
})

test('maps legacy admin emails to omsadmin', () => {
  withEnv({
    NODE_ENV: 'production',
    OMS_BOOTSTRAP_ADMIN_USERNAME: 'admin@oms.local',
    OMS_BOOTSTRAP_ADMIN_PASSWORD: 'DevAdmin123!',
  }, () => {
    assert.deepEqual(resolveBootstrapCredentials(), {
      username: 'omsadmin',
      password: 'DevAdmin123!',
      useDevFallback: false,
    })
  })
})

test('uses the insecure development fallback only when both flags allow it', () => {
  withEnv({
    NODE_ENV: 'development',
    OMS_ALLOW_INSECURE_DEV_AUTH: 'true',
    OMS_BOOTSTRAP_ADMIN_USERNAME: undefined,
    OMS_BOOTSTRAP_ADMIN_PASSWORD: undefined,
    OMS_PORTAL_ADMIN_USERNAME: undefined,
    OMS_PORTAL_ADMIN_PASSWORD: undefined,
    OMS_PORTAL_ADMIN_EMAIL: undefined,
    OMS_BOOTSTRAP_ADMIN_EMAIL: undefined,
  }, () => {
    assert.deepEqual(resolveBootstrapCredentials(), {
      username: 'omsadmin',
      password: 'DevAdmin123!',
      useDevFallback: true,
    })
  })
})

test('rejects a username without a matching password', () => {
  withEnv({
    NODE_ENV: 'production',
    OMS_BOOTSTRAP_ADMIN_USERNAME: 'omsadmin',
    OMS_BOOTSTRAP_ADMIN_PASSWORD: undefined,
    OMS_PORTAL_ADMIN_PASSWORD: undefined,
  }, () => {
    assert.throws(() => resolveBootstrapCredentials(), /must be configured together/)
  })
})
