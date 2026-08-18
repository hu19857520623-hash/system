import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { timingSafeEqual } from 'node:crypto'

export const OMS_ROLES = ['sys_admin', 'ecommerce', 'catalog', 'hybrid'] as const
export type OmsRole = typeof OMS_ROLES[number]

export const SYS_ADMIN_PERMISSIONS = [
  'dashboard:read',
  'order:read', 'order:write', 'order:export',
  'catalog:read', 'catalog:write',
  'product:read', 'product:write',
  'code:read', 'code:apply', 'code:approve',
  'platform:read', 'platform:write',
  'inbound:read', 'inbound:write',
  'outbound:read', 'outbound:write',
  'inventory:read',
  'logistics:read',
  'returns:read', 'returns:write',
  'billing:read', 'billing:recharge',
  'store:manage',
  'report:read',
  'account:manage', 'account:disable', 'account:assign',
] as const

export type AuthClaims = {
  userId: string
  customerId: string | null
  customerCode: string | null
  role: OmsRole
  permissions: string[]
  mustChangePassword: boolean
}

export type AuthenticatedRequest = Request & { auth?: AuthClaims }

const DEV_JWT_SECRET = 'oms-local-development-only-secret-change-me'

export function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/
export const USERNAME_MIN_LENGTH = 6
export const USERNAME_MAX_LENGTH = 50
export const PASSWORD_MIN_LENGTH = 6
export const PASSWORD_MAX_LENGTH = 128

export function normalizeUsername(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export function isValidUsername(value: string) {
  return value.length >= USERNAME_MIN_LENGTH
    && value.length <= USERNAME_MAX_LENGTH
    && USERNAME_PATTERN.test(value)
}

export function requestedUsername(body: { username?: unknown; email?: unknown; loginEmail?: unknown } | null | undefined): string {
  return normalizeUsername(body?.username || body?.email || body?.loginEmail)
}

export function isLoginAllowed(
  userStatus: string | undefined,
  accountStatus: string | undefined,
  passwordMatches: boolean,
  role = 'customer',
  customerId: string | null = 'customer',
) {
  return passwordMatches
    && isPortalIdentityActive(role, userStatus, accountStatus, customerId)
}

export function isPortalIdentityActive(
  role: string | undefined,
  userStatus: string | undefined,
  accountStatus: string | undefined,
  customerId: string | null | undefined,
) {
  if (userStatus !== 'active') return false
  if (role === 'sys_admin') return true
  return Boolean(customerId) && accountStatus === 'active'
}

export function isStrongPassword(value: string) {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH
}

export function getJwtSecret(): string {
  const configured = String(process.env.OMS_JWT_SECRET || '').trim()
  if (configured.length >= 32) return configured
  if (configured) throw new Error('OMS_JWT_SECRET must be at least 32 characters')
  if (
    process.env.NODE_ENV === 'development'
    && process.env.OMS_ALLOW_INSECURE_DEV_AUTH === 'true'
  ) {
    return DEV_JWT_SECRET
  }
  throw new Error(
    'OMS_JWT_SECRET is required. For local development only, set '
    + 'NODE_ENV=development and OMS_ALLOW_INSECURE_DEV_AUTH=true.',
  )
}

export function issueAccessToken(claims: AuthClaims, remember = false): string {
  return jwt.sign(claims, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: remember ? '7d' : '15m',
    subject: claims.userId,
    issuer: 'takealot-oms',
    audience: 'takealot-oms-web',
  })
}

export function verifyAccessToken(token: string): AuthClaims {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: 'takealot-oms',
    audience: 'takealot-oms-web',
  })
  if (typeof decoded === 'string') throw new Error('Invalid token payload')
  const permissions = Array.isArray(decoded.permissions)
    ? decoded.permissions.map(String)
    : []
  const role = String(decoded.role || '')
  const claims = {
    userId: String(decoded.userId || ''),
    customerId: decoded.customerId == null ? null : String(decoded.customerId),
    customerCode: decoded.customerCode == null ? null : String(decoded.customerCode),
    role: role as OmsRole,
    permissions,
    mustChangePassword: Boolean(decoded.mustChangePassword),
  }
  if (
    !claims.userId
    || !OMS_ROLES.includes(claims.role)
    || (
      claims.role !== 'sys_admin'
      && (!claims.customerId || !claims.customerCode)
    )
  ) throw new Error('Invalid token payload')
  return claims
}

export function authenticateApi(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authorization = String(req.header('authorization') || '')
  if (!authorization.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  try {
    req.auth = verifyAccessToken(authorization.slice(7).trim())
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' })
  }
}

export function requireSysAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.auth?.role !== 'sys_admin') {
    res.status(403).json({ error: 'System administrator access required' })
    return
  }
  next()
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Permission required for a mutating /api path, or null to skip. */
export function requiredWritePermission(method: string, apiPath: string): string | null {
  if (!WRITE_METHODS.has(String(method || '').toUpperCase())) return null
  const p = String(apiPath || '').split('?')[0] || '/'
  if (p.startsWith('/auth')) return null
  if (p === '/health' || p.startsWith('/erp/webhooks')) return null
  if (p === '/system-messages/read') return 'dashboard:read'
  if (p.includes('/recharge')) return 'billing:recharge'
  if (p.startsWith('/billing')) return 'billing:recharge'
  if (p.startsWith('/erp/purchase')) return 'catalog:write'
  if (p.startsWith('/erp/products')) return 'product:write'
  if (p.startsWith('/erp/inbound') || p.startsWith('/inbound')) return 'inbound:write'
  if (p.startsWith('/erp/outbound') || p.startsWith('/outbound')) return 'outbound:write'
  if (p.startsWith('/erp/returns') || p.startsWith('/return')) return 'returns:write'
  if (p.startsWith('/orders')) return 'order:write'
  if (p.startsWith('/platform-sku')) return 'platform:write'
  if (p.startsWith('/inventory')) return 'inventory:read'
  if (p.startsWith('/logistics')) return 'logistics:read'
  if (p.startsWith('/accounts') || p.startsWith('/fee-templates') || p.startsWith('/payment-methods')) {
    return 'account:manage'
  }
  if (p.startsWith('/stores')) return 'store:manage'
  return '__unknown_write__'
}

export function assertApiWritePermission(req: AuthenticatedRequest, res: Response) {
  const required = requiredWritePermission(req.method, req.path)
  if (!required) return true
  if (req.auth?.role === 'sys_admin') return true
  if (required !== '__unknown_write__' && req.auth?.permissions?.includes(required)) return true
  res.status(403).json({ error: '没有此项操作权限' })
  return false
}

export function hasValidInternalToken(supplied: unknown): boolean {
  const expected = String(process.env.OMS_INTERNAL_TOKEN || '').trim()
  const received = String(supplied || '').trim()
  if (!expected || !received) return false
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length
    && timingSafeEqual(expectedBytes, receivedBytes)
}

export function requireInternalToken(req: Request, res: Response, next: NextFunction) {
  if (!hasValidInternalToken(req.header('x-oms-internal-token'))) {
    res.status(401).json({ error: 'Internal authentication failed' })
    return
  }
  next()
}

export function customerScope(req: AuthenticatedRequest) {
  return req.auth?.role === 'sys_admin' ? null : req.auth?.customerId || ''
}

export function assertCustomerCode(req: AuthenticatedRequest, res: Response, requested?: unknown) {
  if (req.auth?.role === 'sys_admin') return true
  const code = String(requested || '').trim()
  if (!code || code !== req.auth?.customerCode) {
    res.status(403).json({ error: 'Cross-customer access denied' })
    return false
  }
  return true
}

export function assertCustomerId(req: AuthenticatedRequest, res: Response, requested?: unknown) {
  if (req.auth?.role === 'sys_admin') return true
  const id = String(requested || '').trim()
  if (!id || id !== req.auth?.customerId) {
    res.status(403).json({ error: 'Cross-customer access denied' })
    return false
  }
  return true
}
