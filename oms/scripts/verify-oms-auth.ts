import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apiBase = String(
  process.env.OMS_VERIFY_API_BASE || 'http://127.0.0.1:3001/api',
).replace(/\/$/, '')

async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  return { status: response.status, body }
}

async function main() {
  const suffix = randomUUID()
  const userId = `verify-${suffix}`.slice(0, 50)
  const username = `verify${suffix.replace(/-/g, '').slice(0, 10)}`
  const temporaryPassword = `tmp${randomBytes(4).toString('hex')}`
  const changedPassword = `new${randomBytes(4).toString('hex')}`
  const now = new Date().toISOString()

  await prisma.portalUser.create({
    data: {
      id: userId,
      customerId: null,
      username,
      passwordHash: await bcrypt.hash(temporaryPassword, 4),
      role: 'sys_admin',
      status: 'active',
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    },
  })

  try {
    const unauthorized = await request('/bootstrap')
    assert.equal(unauthorized.status, 401)

    const invalidLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'WrongPassword1' }),
    })
    assert.equal(invalidLogin.status, 401)

    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: temporaryPassword }),
    })
    assert.equal(login.status, 200)
    const loginToken = String(login.body.token || '')
    assert.ok(loginToken)

    const blockedBootstrap = await request('/bootstrap', {
      headers: { Authorization: `Bearer ${loginToken}` },
    })
    assert.equal(blockedBootstrap.status, 403)
    assert.equal(blockedBootstrap.body.code, 'PASSWORD_CHANGE_REQUIRED')

    const changed = await request('/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginToken}` },
      body: JSON.stringify({
        currentPassword: temporaryPassword,
        newPassword: changedPassword,
      }),
    })
    assert.equal(changed.status, 200)
    const changedToken = String(changed.body.token || '')
    assert.ok(changedToken)

    const oldPasswordLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: temporaryPassword }),
    })
    assert.equal(oldPasswordLogin.status, 401)

    await prisma.portalUser.update({
      where: { id: userId },
      data: { status: 'disabled', updatedAt: new Date().toISOString() },
    })
    const disabled = await request('/auth/me', {
      headers: { Authorization: `Bearer ${changedToken}` },
    })
    assert.equal(disabled.status, 401)

    console.log(
      'OMS auth verification passed: unauthorized=401 invalid-login=401 '
      + 'login=200 password-change=200 disabled=401',
    )
  } finally {
    await prisma.portalUser.deleteMany({ where: { id: userId } })
  }
}

main()
  .catch(error => {
    console.error('OMS auth verification failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
