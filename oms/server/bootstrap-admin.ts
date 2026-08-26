import type { PortalUser, PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { isStrongPassword, isValidUsername, normalizeUsername } from './auth.js'

export const LEGACY_BOOTSTRAP_USERNAMES = [
  'admin@oms.local',
  'admin@example.com',
  'admin',
  'omsadmin',
] as const

export type BootstrapCredentials = {
  username: string
  password: string
  useDevFallback: boolean
}

export function resolveBootstrapCredentials(): BootstrapCredentials | null {
  const configuredUsername = normalizeUsername(
    process.env.OMS_PORTAL_ADMIN_USERNAME
      || process.env.OMS_BOOTSTRAP_ADMIN_USERNAME
      || process.env.OMS_PORTAL_ADMIN_EMAIL
      || process.env.OMS_BOOTSTRAP_ADMIN_EMAIL,
  )
  const configuredPassword = String(
    process.env.OMS_PORTAL_ADMIN_PASSWORD
      || process.env.OMS_BOOTSTRAP_ADMIN_PASSWORD
      || '',
  )
  const allowDevFallback = process.env.NODE_ENV === 'development'
    && process.env.OMS_ALLOW_INSECURE_DEV_AUTH === 'true'
  const useDevFallback = !configuredUsername && !configuredPassword && allowDevFallback
  const mappedConfigured = configuredUsername === 'admin@oms.local'
    || configuredUsername === 'admin@example.com'
    || configuredUsername.startsWith('admin@')
    ? 'omsadmin'
    : configuredUsername.includes('@')
      ? normalizeUsername(configuredUsername.split('@')[0])
      : configuredUsername
  const username = useDevFallback ? 'omsadmin' : mappedConfigured
  const password = useDevFallback ? 'DevAdmin123!' : configuredPassword
  if (!username && !password) return null
  if (!username || !password) {
    throw new Error(
      'OMS_BOOTSTRAP_ADMIN_USERNAME and OMS_BOOTSTRAP_ADMIN_PASSWORD must be configured together',
    )
  }
  if (!isValidUsername(username)) {
    throw new Error('OMS_BOOTSTRAP_ADMIN_USERNAME is invalid')
  }
  if (!isStrongPassword(password)) {
    throw new Error('OMS_BOOTSTRAP_ADMIN_PASSWORD does not meet the password policy')
  }
  return { username, password, useDevFallback }
}

export async function findBootstrapPortalAdmin(
  prisma: PrismaClient,
  configuredUsername: string,
): Promise<PortalUser | null> {
  const byUsername = await prisma.portalUser.findUnique({ where: { username: configuredUsername } })
  if (byUsername?.role === 'sys_admin' && !byUsername.customerId) return byUsername

  const adminId = String(process.env.OMS_PORTAL_ADMIN_ID || 'portal-admin').trim()
  if (adminId) {
    const byId = await prisma.portalUser.findUnique({ where: { id: adminId } })
    if (byId?.role === 'sys_admin' && !byId.customerId) return byId
  }

  for (const legacyUsername of LEGACY_BOOTSTRAP_USERNAMES) {
    if (legacyUsername === configuredUsername) continue
    const legacy = await prisma.portalUser.findUnique({ where: { username: legacyUsername } })
    if (legacy?.role === 'sys_admin' && !legacy.customerId) return legacy
  }

  return prisma.portalUser.findFirst({
    where: { role: 'sys_admin', customerId: null },
    orderBy: { createdAt: 'asc' },
  })
}

export async function ensureConfiguredPortalAdmin(prisma: PrismaClient) {
  const credentials = resolveBootstrapCredentials()
  if (!credentials) return { action: 'skipped' as const }
  const { username, password, useDevFallback } = credentials
  const now = new Date().toISOString()
  const existing = await findBootstrapPortalAdmin(prisma, username)

  if (existing) {
    if (existing.role !== 'sys_admin' || existing.customerId !== null) {
      throw new Error('OMS_BOOTSTRAP_ADMIN_USERNAME is already assigned to a customer identity')
    }
    const passwordMatches = await bcrypt.compare(password, existing.passwordHash)
    const usernameMatches = existing.username === username
    if (passwordMatches && usernameMatches) {
      return { action: 'unchanged' as const, username }
    }
    if (!usernameMatches) {
      const conflict = await prisma.portalUser.findUnique({ where: { username } })
      if (conflict && conflict.id !== existing.id) {
        throw new Error(`Cannot rename bootstrap admin to ${username}: username already exists`)
      }
    }
    await prisma.portalUser.update({
      where: { id: existing.id },
      data: {
        username,
        passwordHash: passwordMatches ? existing.passwordHash : await bcrypt.hash(password, 12),
        status: 'active',
        updatedAt: now,
      },
    })
    console.log(`Configured OMS portal administrator synced: ${existing.username} -> ${username}`)
    return { action: 'updated' as const, username }
  }

  const id = String(process.env.OMS_PORTAL_ADMIN_ID || 'portal-admin').trim()
  if (!id || id.length > 50) throw new Error('OMS_PORTAL_ADMIN_ID is invalid')
  await prisma.portalUser.create({
    data: {
      id,
      customerId: null,
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'sys_admin',
      status: 'active',
      mustChangePassword: useDevFallback
        || process.env.OMS_PORTAL_ADMIN_MUST_CHANGE_PASSWORD !== 'false',
      createdAt: now,
      updatedAt: now,
    },
  })
  console.log(`Configured OMS portal administrator created: ${username}`)
  return { action: 'created' as const, username }
}

export async function resolvePortalUserForLogin(
  prisma: PrismaClient,
  username: string,
) {
  const direct = await prisma.portalUser.findUnique({
    where: { username },
    include: { customerAccount: true },
  })
  if (direct) return direct

  if (username !== 'omsadmin') return null

  for (const legacyUsername of LEGACY_BOOTSTRAP_USERNAMES) {
    if (legacyUsername === 'omsadmin') continue
    const legacy = await prisma.portalUser.findUnique({
      where: { username: legacyUsername },
      include: { customerAccount: true },
    })
    if (legacy?.role === 'sys_admin' && !legacy.customerId) return legacy
  }

  const adminId = String(process.env.OMS_PORTAL_ADMIN_ID || 'portal-admin').trim()
  if (!adminId) return null
  return prisma.portalUser.findUnique({
    where: { id: adminId },
    include: { customerAccount: true },
  })
}
