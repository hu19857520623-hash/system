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
  return value.length >= 10
    && value.length <= 128
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
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

export function issueAccessToken(claims: AuthClaims): string {
  return jwt.sign(claims, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '15m',
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
