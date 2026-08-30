import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import type { NextFunction, Response } from 'express'
import   {
    assertCustomerId,
    authenticateApi,
    hasValidInternalToken,
    isLoginAllowed,
    isPortalIdentityActive,
    isStrongPassword,
    issueAccessToken,
    isValidUsername,
    normalizeUsername,
    requiredWritePermission,
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

test('normalizes username and validates bcrypt credentials', async () => {
  const hash = await bcrypt.hash('temporary-password', 4)
  assert.equal(normalizeUsername('  Acme_01 '), 'acme_01')
  assert.equal(isValidUsername('acme01'), true)
  assert.equal(isValidUsername('admin'), false)
  assert.equal(isValidUsername('user@oms.local'), false)
  assert.equal(await bcrypt.compare('temporary-password', hash), true)
  assert.equal(await bcrypt.compare('wrong-password', hash), false)
  assert.equal(isLoginAllowed('active', 'active', true), true)
  assert.equal(isLoginAllowed('disabled', 'active', true), false)
  assert.equal(isLoginAllowed('active', 'disabled', true), false)
  assert.equal(isLoginAllowed('active', 'active', false), false)
  assert.equal(isPortalIdentityActive('sys_admin', 'active', undefined, null), true)
  assert.equal(isPortalIdentityActive('sys_admin', 'disabled', undefined, null), false)
  assert.equal(isPortalIdentityActive('ecommerce', 'active', undefined, 'customer-1'), false)
  assert.equal(isStrongPassword('123456'), true)
  assert.equal(isStrongPassword('12345'), false)
})

test('internal authentication rejects missing or incorrect tokens', () => {
  assert.equal(hasValidInternalToken(undefined), false)
  assert.equal(hasValidInternalToken('wrong-token'), false)
  assert.equal(hasValidInternalToken('test-internal-token'), true)
})

test('remembered sessions last longer than short-lived tokens', () => {
  const shortToken = issueAccessToken(claims, false)
  const longToken = issueAccessToken(claims, true)
  const shortExp = (JSON.parse(Buffer.from(shortToken.split('.')[1], 'base64url').toString()) as { exp: number }).exp
  const longExp = (JSON.parse(Buffer.from(longToken.split('.')[1], 'base64url').toString()) as { exp: number }).exp
  assert.ok(longExp - shortExp > 6 * 24 * 60 * 60)
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

test('maps mutating OMS API paths to write permissions', () => {
  assert.equal(requiredWritePermission('GET', '/outbound-orders'), null)
  assert.equal(requiredWritePermission('POST', '/auth/change-password'), null)
  assert.equal(requiredWritePermission('POST', '/erp/outbound'), 'outbound:write')
  assert.equal(requiredWritePermission('POST', '/erp/customers/TKL0001/recharge'), 'billing:recharge')
  assert.equal(requiredWritePermission('PUT', '/inbound-orders'), 'inbound:write')
  assert.equal(requiredWritePermission('POST', '/erp/purchase'), 'catalog:write')
  assert.equal(requiredWritePermission('PUT', '/platform-sku'), 'platform:write')
  assert.equal(requiredWritePermission('POST', '/erp/returns'), 'returns:write')
  assert.equal(requiredWritePermission('POST', '/accounts'), 'account:manage')
})
