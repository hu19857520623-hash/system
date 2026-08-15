import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import type { NextFunction, Response } from 'express'
import {
  assertCustomerId,
  authenticateApi,
  hasValidInternalToken,
  isLoginAllowed,
  isPortalIdentityActive,
  isStrongPassword,
  issueAccessToken,
  normalizeEmail,
  verifyAccessToken,
  type AuthClaims,
  type AuthenticatedRequest,
} from './auth.js'

const claims: AuthClaims = {
  userId: 'user-1',
  customerId: 'customer-1',
  customerCode: 'TKL0001',
  role: 'ecommerce',
  permissions: ['inventory:read'],
  mustChangePassword: true,
}

test.before(() => {
  process.env.OMS_JWT_SECRET = 'test-only-secret-with-at-least-32-characters'
  process.env.OMS_INTERNAL_TOKEN = 'test-internal-token'
})

test('normalizes email and validates bcrypt credentials', async () => {
  const hash = await bcrypt.hash('temporary-password', 4)
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com')
  assert.equal(await bcrypt.compare('temporary-password', hash), true)
  assert.equal(await bcrypt.compare('wrong-password', hash), false)
  assert.equal(isLoginAllowed('active', 'active', true), true)
  assert.equal(isLoginAllowed('disabled', 'active', true), false)
  assert.equal(isLoginAllowed('active', 'disabled', true), false)
  assert.equal(isLoginAllowed('active', 'active', false), false)
  assert.equal(isPortalIdentityActive('sys_admin', 'active', undefined, null), true)
  assert.equal(isPortalIdentityActive('sys_admin', 'disabled', undefined, null), false)
  assert.equal(isPortalIdentityActive('ecommerce', 'active', undefined, 'customer-1'), false)
  assert.equal(isStrongPassword('Temporary1A'), true)
  assert.equal(isStrongPassword('all-lowercase-1'), false)
})

test('internal authentication rejects missing or incorrect tokens', () => {
  assert.equal(hasValidInternalToken(undefined), false)
  assert.equal(hasValidInternalToken('wrong-token'), false)
  assert.equal(hasValidInternalToken('test-internal-token'), true)
})

test('JWT preserves must-change and customer scope claims', () => {
  const token = issueAccessToken(claims)
  assert.deepEqual(verifyAccessToken(token), claims)
})

test('customer-less system administrator claims are valid', () => {
  const adminClaims: AuthClaims = {
    userId: 'admin-1',
    customerId: null,
    customerCode: null,
    role: 'sys_admin',
    permissions: ['account:manage'],
    mustChangePassword: true,
  }
  assert.equal(isLoginAllowed('active', undefined, true, 'sys_admin', null), true)
  assert.deepEqual(verifyAccessToken(issueAccessToken(adminClaims)), adminClaims)
})

test('authentication middleware returns 401 without a bearer token', () => {
  let status = 0
  let body: unknown
  let nextCalled = false
  const req = { header: () => undefined } as unknown as AuthenticatedRequest
  const res = {
    status(code: number) {
      status = code
      return this
    },
    json(value: unknown) {
      body = value
      return this
    },
  } as unknown as Response
  authenticateApi(req, res, (() => { nextCalled = true }) as NextFunction)
  assert.equal(status, 401)
  assert.equal(nextCalled, false)
  assert.deepEqual(body, { error: 'Authentication required' })
})

test('rejects cross-customer mutation scope', () => {
  let status = 0
  const req = { auth: claims } as AuthenticatedRequest
  const res = {
    status(code: number) {
      status = code
      return this
    },
    json() {
      return this
    },
  } as unknown as Response
  assert.equal(assertCustomerId(req, res, 'customer-2'), false)
  assert.equal(status, 403)
  assert.equal(assertCustomerId(req, res, 'customer-1'), true)
})

test('accepts a valid bearer JWT', () => {
  const token = issueAccessToken(claims)
  const req = {
    header: (name: string) => name === 'authorization' ? `Bearer ${token}` : undefined,
  } as unknown as AuthenticatedRequest
  const res = {} as Response
  let nextCalled = false
  authenticateApi(req, res, (() => { nextCalled = true }) as NextFunction)
  assert.equal(nextCalled, true)
  assert.deepEqual(req.auth, claims)
})
