import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPortalLoginUsername,
  buildPortalLoginUsernameWithSuffix,
  normalizePortalLoginIdentifier,
  normalizePortalLoginPhone,
} from './portal-login.util.js'

test('normalizePortalLoginPhone strips formatting', () => {
  assert.equal(normalizePortalLoginPhone('+86 138-0013 8000'), '8613800138000')
})

test('buildPortalLoginUsername uses digits only', () => {
  assert.equal(buildPortalLoginUsername('138 0013 8000'), '13800138000')
})

test('buildPortalLoginUsernameWithSuffix appends customer code', () => {
  assert.equal(
    buildPortalLoginUsernameWithSuffix('13800138000', 'TKL0042'),
    '13800138000tkl0042',
  )
})

test('normalizePortalLoginIdentifier keeps admin usernames', () => {
  assert.equal(normalizePortalLoginIdentifier('omsadmin'), 'omsadmin')
})

test('normalizePortalLoginIdentifier normalizes phone input', () => {
  assert.equal(normalizePortalLoginIdentifier('138-0013-8000'), '13800138000')
})
