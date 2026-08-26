import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { resolveOmsCorsOrigins } from './cors.js'
import {
  assertCustomerCode,
  assertCustomerId,
  authenticateApi,
  customerScope,
  getJwtSecret,
  isLoginAllowed,
  isPortalIdentityActive,
  isStrongPassword,
  isValidUsername,
  issueAccessToken,
  normalizeEmail,
  normalizeUsername,
  requestedUsername,
  OMS_ROLES,
  requireInternalToken,
  requireSysAdmin,
  assertApiWritePermission,
  SYS_ADMIN_PERMISSIONS,
  type AuthClaims,
  type AuthenticatedRequest,
  type OmsRole,
} from './auth.js'
import { LoginRateLimiter } from './login-rate-limit.js'
import { ensureConfiguredPortalAdmin, resolvePortalUserForLogin } from './bootstrap-admin.js'
import {
  refundOutboundPreDeduct,
  settleOutboundFees,
  type OutboundFeesPayload,
} from './outbound-settlement.util'
import { applyErpBillingChanged, openPreDeductTotal, type ErpBillingChangedPayload } from './billing-sync.util'
import {
  ErpApiError,
  createErpInboundAsn,
  createErpOutbound,
  createErpProduct,
  createErpRecharge,
  createErpReturn,
  cancelErpReturn as cancelErpReturnApi,
  decideErpReturn as decideErpReturnApi,
  downloadErpReturnAttachment,
  downloadErpOutboundPod,
  fetchErpAnnouncements,
  fetchErpBills,
  fetchErpCatalog,
  fetchErpCatalogSku,
  fetchErpCharges,
  fetchErpCustomerByCode,
  fetchErpInboundByNo,
  fetchErpInboundsByCustomer,
  fetchErpInventoryView,
  fetchErpLogisticsByCustomer,
  fetchErpOutboundByNo,
  uploadErpPodReceipt,
  fetchErpOutboundsByCustomer,
  fetchErpSkuOutbounds,
  fetchErpReturnByNo,
  fetchErpReturnsByCustomer,
  fetchErpRecharges,
  fetchErpSkuInventoryByCode,
  getErpApiBase,
  provisionOmsCustomer,
  purchaseErpCatalog,
  resetOmsPortalPassword,
  updateOmsCustomer,
  type ErpInboundOrder,
  type ErpOutboundOrder,
  type ErpReturnOrder,
} from './erpClient.js'

const prisma = new PrismaClient()
const loginLimiter = new LoginRateLimiter()
const app = express()
const PORT = Number(process.env.API_PORT || 3001)
const WEBHOOK_SECRET = String(process.env.OMS_WEBHOOK_SECRET || '').trim()
getJwtSecret()

const corsOrigins = resolveOmsCorsOrigins(process.env.OMS_CORS_ORIGINS, process.env.NODE_ENV)
app.use(cors({ origin: corsOrigins, credentials: true }))
app.use(express.json({
  limit: '15mb',
  verify: (req, _res, buffer) => {
    ;(req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer)
  },
}))

const SENSITIVE_ERROR_KEY = /(authorization|cookie|password|passwordHash|secret|token)/i
const BCRYPT_VALUE = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g

function redactErrorString(value: string) {
  let redacted = value.replace(BCRYPT_VALUE, '[REDACTED]').replace(JWT_VALUE, '[REDACTED]')
  for (const secret of [
    process.env.OMS_INTERNAL_TOKEN,
    process.env.OMS_JWT_SECRET,
    process.env.OMS_WEBHOOK_SECRET,
  ]) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

function sanitizeErrorPayload(value: unknown): unknown {
  if (typeof value === 'string') return redactErrorString(value)
  if (Array.isArray(value)) return value.map(sanitizeErrorPayload)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    SENSITIVE_ERROR_KEY.test(key) ? '[REDACTED]' : sanitizeErrorPayload(nested),
  ]))
}

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  const json = res.json.bind(res)
  res.json = ((body: unknown) => json(
    res.statusCode >= 400 ? sanitizeErrorPayload(body) : body,
  )) as typeof res.json
  next()
})

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function toOmsWarehouseCode(code?: string | null, fallback = 'jhb1'): string {
  const raw = String(code || '').trim().toLowerCase()
  if (!raw) return fallback
  if (['jhb1', 'jhb3', 'cpt1', 'cpt2', 'dbn'].includes(raw)) return raw
  if (raw.includes('jhb')) return 'jhb1'
  if (raw.includes('cpt')) return 'cpt1'
  if (raw.includes('dbn')) return 'dbn'
  return fallback
}

function validWebhookSignature(rawBody: Buffer, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false
  if (!signature.startsWith('sha256=')) return false
  const received = Buffer.from(signature.slice('sha256='.length), 'hex')
  const expected = Buffer.from(createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex'), 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

async function buildUnscopedBootstrap(
  scope?: { customerId: string; customerCode: string },
) {
  // 一次性兼容旧商品状态：系统已取消“审核不通过”，历史数据保留并归入“废弃”。
  await prisma.product.updateMany({
    where: { productStatus: 'rejected' },
    data: { productStatus: 'discarded' },
  })
  const [
    customers,
    billing,
    feeRecords,
    stores,
    products,
    inventory,
    orders,
    inboundOrders,
    outboundOrders,
    returnOrders,
    codeMappings,
    platformSkuMappings,
    logistics,
    qcReports,
    systemMessages,
    announcements,
    priceTemplates,
    storageTemplates,
    regionRules,
    purchases,
    paymentMethods,
  ] = await Promise.all([
    prisma.customerAccount.findMany({
      where: scope ? { id: scope.customerId } : undefined,
      orderBy: { id: 'asc' },
    }),
    scope
      ? prisma.billingAccount.findUnique({ where: { customerId: scope.customerId } })
      : prisma.billingAccount.findFirst({ orderBy: { id: 'asc' } }),
    prisma.feeRecord.findMany({
      where: scope ? { customerCode: scope.customerCode } : undefined,
      orderBy: { date: 'desc' },
    }),
    prisma.storeAccount.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { id: 'asc' },
    }),
    prisma.product.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { id: 'asc' },
    }),
    prisma.inventoryItem.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { id: 'asc' },
    }),
    prisma.order.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.inboundOrder.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.outboundOrder.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.returnOrder.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.codeMapping.findMany({ orderBy: { id: 'asc' } }),
    prisma.platformSkuMapping.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { id: 'asc' },
    }),
    prisma.logisticsRecord.findMany({ orderBy: { updatedAt: 'desc' } }),
    prisma.qcReport.findMany({ orderBy: { reportDate: 'desc' } }),
    prisma.systemMessage.findMany({
      where: scope
        ? { OR: [{ customerId: null }, { customerId: scope.customerId }] }
        : undefined,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.announcement.findMany({ orderBy: { date: 'desc' } }),
    prisma.priceTemplate.findMany(),
    prisma.storageRentTemplate.findMany(),
    prisma.regionDispatchRule.findMany({ orderBy: { id: 'asc' } }),
    prisma.catalogPurchase.findMany({
      where: scope ? { customerId: scope.customerId } : undefined,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.paymentMethod.findMany({ orderBy: { sortOrder: 'asc' } }),
  ])

  return {
    accounts: customers.map(c => ({
      ...c,
      permissions: parseJson<string[]>(c.permissions, []),
      priceTemplateByRegion: c.priceTemplateByRegion
        ? parseJson<Record<string, string | null>>(c.priceTemplateByRegion, {})
        : undefined,
    })),
    billing: billing
      ? {
          creditBalance: billing.creditBalance,
          monthlySpent: billing.monthlySpent,
          pendingBill: billing.pendingBill,
          budgetUsed: billing.budgetUsed,
          name: billing.name,
          code: billing.code,
          contact: billing.contact,
          warehouse: billing.warehouse,
        }
      : null,
    feeRecords,
    stores,
    products,
    inventory,
    orders: orders.map(o => ({
      ...o,
      items: parseJson(o.items, []),
      tracking: parseJson(o.tracking, []),
      fees: parseJson(o.fees, []),
      logs: parseJson(o.logs, []),
    })),
    inboundOrders: inboundOrders.map(o => ({
      ...o,
      lineItems: o.lineItems ? parseJson(o.lineItems, []) : undefined,
      attachments: o.attachments ? parseJson(o.attachments, []) : undefined,
    })),
    outboundOrders: outboundOrders.map(o => ({
      ...o,
      preDeductFees: o.preDeductFees ? parseJson(o.preDeductFees, []) : undefined,
      recipient: o.recipient ? parseJson(o.recipient, undefined) : undefined,
      preDeduct: o.preDeductSnapshot ? parseJson(o.preDeductSnapshot, undefined) : undefined,
      measure: o.measureSnapshot ? parseJson(o.measureSnapshot, undefined) : undefined,
      actualFees: o.actualFeesSnapshot ? parseJson(o.actualFeesSnapshot, undefined) : undefined,
      lineItems: o.lineItems ? parseJson(o.lineItems, []) : undefined,
      attachments: o.attachments ? parseJson(o.attachments, []) : undefined,
      actualFeesTotal: o.actualFeesTotal ?? undefined,
      settlementDelta: o.settlementDelta ?? undefined,
      settlementStatus: o.settlementStatus ?? undefined,
      measuredVolumeM3: o.measuredVolumeM3 ?? undefined,
      measuredWeightKg: o.measuredWeightKg ?? undefined,
      preDeductTotal: o.preDeductTotal ?? undefined,
      preDeductVolumeM3: o.preDeductVolumeM3 ?? undefined,
      preDeductWeightKg: o.preDeductWeightKg ?? undefined,
      destRegion: o.destRegion ?? undefined,
      priceTemplateId: o.priceTemplateId ?? undefined,
      priceTemplateName: o.priceTemplateName ?? undefined,
    })),
    returnOrders: returnOrders.map(o => ({
      ...o,
      lineItems: o.lineItems ? parseJson(o.lineItems, []) : [],
      attachments: o.attachments ? parseJson(o.attachments, []) : [],
      estimatedFeeTotal: o.estimatedFeeTotal == null ? undefined : Number(o.estimatedFeeTotal),
      totalVolumeCbm: o.totalVolumeCbm == null ? undefined : Number(o.totalVolumeCbm),
    })),
    codeMappings,
    platformSkuMappings: platformSkuMappings.map(m => ({
      ...m,
      lines: parseJson(m.lines, []),
    })),
    logistics,
    qcReports,
    systemMessages,
    announcements,
    feeTemplates: {
      priceTemplates: priceTemplates.map(pt => ({
        ...pt,
        regionCode: pt.regionCode ?? 'jhb',
        handling: parseJson(pt.handling, {}),
        shippingByRegion: parseJson(pt.shippingByRegion, {}),
        pickupByRegion: parseJson(pt.pickupByRegion, {}),
      })),
      priceTemplate: priceTemplates[0]
        ? {
            ...priceTemplates[0],
            regionCode: priceTemplates[0].regionCode ?? 'jhb',
            handling: parseJson(priceTemplates[0].handling, {}),
            shippingByRegion: parseJson(priceTemplates[0].shippingByRegion, {}),
            pickupByRegion: parseJson(priceTemplates[0].pickupByRegion, {}),
          }
        : null,
      storageTemplate: storageTemplates[0] ?? null,
      regionDispatchRules: regionRules,
    },
    paymentMethods,
    purchases,
  }
}

async function buildBootstrap(auth: AuthClaims) {
  if (auth.role !== 'sys_admin' && (!auth.customerId || !auth.customerCode)) {
    throw new Error('Authenticated customer scope is missing')
  }
  const all = await buildUnscopedBootstrap(
    auth.role === 'sys_admin'
      ? undefined
      : { customerId: auth.customerId!, customerCode: auth.customerCode! },
  )
  const portalUsers = await prisma.portalUser.findMany({
    select: {
      customerId: true,
      username: true,
      status: true,
      mustChangePassword: true,
      lastLoginAt: true,
    },
  })
  const portalByCustomer = new Map(portalUsers.map(user => [user.customerId, user]))
  const accountsWithReadiness = all.accounts.map(account => ({
    ...account,
    portalUser: portalByCustomer.get(account.id) ?? null,
  }))

  if (auth.role === 'sys_admin') {
    const billingAccounts = await prisma.billingAccount.findMany({ orderBy: { id: 'asc' } })
    return { ...all, accounts: accountsWithReadiness, billingAccounts }
  }

  const customerId = auth.customerId!
  const customerCode = auth.customerCode!
  const account = accountsWithReadiness.find(item => item.id === customerId)
  const customerProducts = all.products.filter(item => item.customerId === customerId)
  const customerInbound = all.inboundOrders.filter(item => item.customerId === customerId)
  const customerOutbound = all.outboundOrders.filter(item => item.customerId === customerId)
  const customerProductSkus = new Set(customerProducts.map(item => item.internalSku))
  const inboundNos = new Set(customerInbound.map(item => item.inboundNo))
  const outboundNos = new Set(customerOutbound.map(item => item.outboundNo))
  const billing = await prisma.billingAccount.findUnique({ where: { customerId } })

  return {
    ...all,
    accounts: account ? [account] : [],
    billing: billing
      ? {
          creditBalance: billing.creditBalance,
          monthlySpent: billing.monthlySpent,
          pendingBill: billing.pendingBill,
          budgetUsed: billing.budgetUsed,
          name: billing.name,
          code: billing.code,
          contact: billing.contact,
          warehouse: billing.warehouse,
        }
      : null,
    billingAccounts: billing ? [billing] : [],
    feeRecords: all.feeRecords.filter(item => item.customerCode === customerCode),
    stores: all.stores.filter(item => item.customerId === customerId),
    products: customerProducts,
    inventory: all.inventory.filter(item => item.customerId === customerId),
    orders: all.orders.filter(item => item.customerId === customerId),
    inboundOrders: customerInbound,
    outboundOrders: customerOutbound,
    returnOrders: all.returnOrders.filter(item => item.customerId === customerId),
    codeMappings: all.codeMappings.filter(item => customerProductSkus.has(item.internalSku)),
    platformSkuMappings: all.platformSkuMappings.filter(item => item.customerId === customerId),
    logistics: all.logistics.filter(item => outboundNos.has(item.outboundNo)),
    qcReports: all.qcReports.filter(item => inboundNos.has(item.inboundNo)),
    systemMessages: all.systemMessages.filter(
      item => item.customerId === null || item.customerId === customerId,
    ),
    purchases: all.purchases.filter(item => item.customerId === customerId),
  }
}

function publicSession(
  token: string,
  claims: AuthClaims,
  identity: PortalIdentity,
) {
  return {
    token,
    user: {
      userId: claims.userId,
      customerId: claims.customerId,
      customerCode: claims.customerCode,
      role: claims.role,
      permissions: claims.permissions,
      mustChangePassword: claims.mustChangePassword,
      username: identity.username,
      loginEmail: identity.username,
      email: identity.username,
      name: identity.customerAccount?.name || identity.username,
      type: identity.customerAccount?.type || null,
      warehouse: identity.customerAccount?.warehouse || '',
    },
  }
}

async function loadPortalIdentity(userId: string) {
  return prisma.portalUser.findUnique({
    where: { id: userId },
    include: { customerAccount: true },
  })
}

type PortalIdentity = NonNullable<Awaited<ReturnType<typeof loadPortalIdentity>>>

function currentPermissions(identity: PortalIdentity) {
  if (identity.role === 'sys_admin') return [...SYS_ADMIN_PERMISSIONS]
  return identity.customerAccount
    ? parseJson<string[]>(identity.customerAccount.permissions, [])
    : []
}

function claimsForIdentity(identity: PortalIdentity): AuthClaims {
  return {
    userId: identity.id,
    customerId: identity.customerId,
    customerCode: identity.customerAccount?.code ?? null,
    role: identity.role as OmsRole,
    permissions: currentPermissions(identity),
    mustChangePassword: identity.mustChangePassword,
  }
}

function activeIdentity(identity: PortalIdentity | null) {
  return Boolean(identity && OMS_ROLES.includes(identity.role as OmsRole) && isPortalIdentityActive(
    identity.role,
    identity.status,
    identity.customerAccount?.status,
    identity.customerId,
  ))
}

async function refreshAuthenticatedIdentity(
  req: AuthenticatedRequest,
  res: express.Response,
) {
  const identity = await loadPortalIdentity(req.auth!.userId)
  if (
    !identity
    || !activeIdentity(identity)
    || identity.role !== req.auth!.role
    || identity.customerId !== req.auth!.customerId
  ) {
    res.status(401).json({ error: 'Session is no longer active' })
    return false
  }
  req.auth = claimsForIdentity(identity)
  return true
}

function authenticateActiveApi(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction,
) {
  authenticateApi(req, res, () => {
    void refreshAuthenticatedIdentity(req, res)
      .then(active => {
        if (active) next()
      })
      .catch(error => {
        console.error('[auth status]', error)
        res.status(503).json({ error: 'Authentication service unavailable' })
      })
  })
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = requestedUsername(req.body)
    const password = String(req.body?.password || '')
    if (!username || !password) {
      return res.status(400).json({ error: '请输入登录账号和密码' })
    }
    const rateKey = `${req.ip || req.socket.remoteAddress || 'unknown'}:${username}`
    try {
      loginLimiter.assertAllowed(rateKey)
    } catch (error) {
      if ((error as { status?: number }).status === 429) {
        return res.status(429).json({ error: (error as Error).message })
      }
      throw error
    }
    const portalUser = await resolvePortalUserForLogin(prisma, username)
    if (!portalUser || !OMS_ROLES.includes(portalUser.role as OmsRole) || !isLoginAllowed(
      portalUser.status,
      portalUser.customerAccount?.status,
      await bcrypt.compare(password, portalUser.passwordHash),
      portalUser.role,
      portalUser.customerId,
    )) {
      loginLimiter.recordFailure(rateKey)
      return res.status(401).json({ error: '账号或密码不正确，或账号已停用' })
    }
    loginLimiter.recordSuccess(rateKey)
    const claims = claimsForIdentity(portalUser)
    const now = new Date().toISOString()
    await prisma.$transaction(async tx => {
      await tx.portalUser.update({
        where: { id: portalUser.id },
        data: { lastLoginAt: now },
      })
      if (portalUser.customerId) {
        await tx.customerAccount.update({
          where: { id: portalUser.customerId },
          data: { lastLoginAt: now.slice(0, 19).replace('T', ' ') },
        })
      }
    })
    res.json(publicSession(issueAccessToken(claims, Boolean(req.body?.remember)), claims, portalUser))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '登录服务暂不可用' })
  }
})

app.get('/api/auth/me', authenticateApi, async (req: AuthenticatedRequest, res) => {
  try {
    const portalUser = await loadPortalIdentity(req.auth!.userId)
    if (!portalUser || !activeIdentity(portalUser)) {
      return res.status(401).json({ error: '账号已停用' })
    }
    const claims = claimsForIdentity(portalUser)
    res.json({
      ...claims,
      username: portalUser.username,
      loginEmail: portalUser.username,
      email: portalUser.username,
      name: portalUser.customerAccount?.name || portalUser.username,
      type: portalUser.customerAccount?.type || null,
      warehouse: portalUser.customerAccount?.warehouse || '',
    })
  } catch (error) {
    console.error('[auth me]', error)
    res.status(503).json({ error: 'Authentication service unavailable' })
  }
})

app.post('/api/auth/change-password', authenticateApi, async (req: AuthenticatedRequest, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '')
    const newPassword = String(req.body?.newPassword || '')
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: '新密码须为 6-128 位' })
    }
    const portalUser = await loadPortalIdentity(req.auth!.userId)
    if (
      !portalUser
      || !activeIdentity(portalUser)
      || !(await bcrypt.compare(currentPassword, portalUser.passwordHash))
    ) {
      return res.status(401).json({ error: '当前密码不正确' })
    }
    const updated = await prisma.portalUser.update({
      where: { id: portalUser.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        mustChangePassword: false,
        updatedAt: new Date().toISOString(),
      },
    })
    const claims: AuthClaims = {
      ...claimsForIdentity(portalUser),
      mustChangePassword: false,
    }
    res.json(publicSession(issueAccessToken(claims, Boolean(req.body?.remember)), claims, {
      ...portalUser,
      ...updated,
    }))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '密码修改失败' })
  }
})

app.post('/api/auth/logout', authenticateApi, (_req, res) => {
  res.json({ ok: true })
})

async function resetCustomerTemporaryPassword(
  customerId: string,
  requestedLogin: unknown,
  temporaryPassword: string,
) {
  if (!isStrongPassword(temporaryPassword)) {
    return { status: 400, error: '临时密码须为 6-128 位' } as const
  }
  const account = await prisma.customerAccount.findUnique({
    where: { id: customerId },
    include: { portalUser: { select: { username: true } } },
  })
  if (!account) return { status: 404, error: '客户不存在' } as const
  const username = normalizeUsername(requestedLogin) || account.portalUser?.username || ''
  if (!isValidUsername(username)) {
    return { status: 400, error: '登录账号须为 6-50 位字母、数字、点、下划线或短横线' } as const
  }
  const updated = await resetOmsPortalPassword(account.code, {
    username,
    temporaryPassword,
  })
  return { status: 200, data: updated } as const
}

app.post(
  [
    '/api/accounts/:id/reset-temporary-password',
    '/api/accounts/:id/reset-password',
  ],
  authenticateActiveApi,
  requireSysAdmin,
  async (req, res) => {
    try {
      if ((req as AuthenticatedRequest).auth?.mustChangePassword) {
        return res.status(403).json({
          error: '首次登录必须先修改密码',
          code: 'PASSWORD_CHANGE_REQUIRED',
        })
      }
      const result = await resetCustomerTemporaryPassword(
        String(req.params.id),
        req.body?.username ?? req.body?.loginEmail,
        String(req.body?.temporaryPassword || ''),
      )
      if ('error' in result) return res.status(result.status).json({ error: result.error })
      res.json(result.data)
    } catch (error) {
      sendErpError(res, error)
    }
  },
)

app.post(
  '/api/internal/bootstrap-admin/sync',
  requireInternalToken,
  async (_req, res) => {
    try {
      const result = await ensureConfiguredPortalAdmin(prisma)
      res.json({ ok: true, ...result })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: String(error) })
    }
  },
)

app.post(
  '/api/internal/accounts/:id/reset-temporary-password',
  requireInternalToken,
  async (req, res) => {
    try {
      const result = await resetCustomerTemporaryPassword(
        String(req.params.id),
        req.body?.username ?? req.body?.loginEmail,
        String(req.body?.temporaryPassword || ''),
      )
      if ('error' in result) return res.status(result.status).json({ error: result.error })
      res.json(result.data)
    } catch (error) {
      sendErpError(res, error)
    }
  },
)

function collectRequestedCustomerScopes(
  value: unknown,
  ids: string[] = [],
  codes: string[] = [],
) {
  if (!value || typeof value !== 'object') return { ids, codes }
  if (Array.isArray(value)) {
    for (const item of value) collectRequestedCustomerScopes(item, ids, codes)
    return { ids, codes }
  }
  const record = value as Record<string, unknown>
  if (record.customerId !== undefined) ids.push(String(record.customerId))
  if (record.customerCode !== undefined) codes.push(String(record.customerCode))
  for (const [key, nested] of Object.entries(record)) {
    if (key !== 'customerId' && key !== 'customerCode') {
      collectRequestedCustomerScopes(nested, ids, codes)
    }
  }
  return { ids, codes }
}

function authenticatedCustomerCode(req: express.Request, supplied: unknown) {
  const auth = (req as AuthenticatedRequest).auth
  return auth?.role === 'sys_admin'
    ? String(supplied || '').trim()
    : auth?.customerCode || ''
}

app.use('/api', (req: AuthenticatedRequest, res, next) => {
  if (req.path === '/health' || req.path === '/erp/webhooks/events') {
    next()
    return
  }
  authenticateApi(req, res, async () => {
    try {
      if (!(await refreshAuthenticatedIdentity(req, res))) return
      if (!assertApiWritePermission(req, res)) return
      if (
        req.auth?.mustChangePassword
        && req.path !== '/auth/me'
        && req.path !== '/auth/change-password'
        && req.path !== '/auth/logout'
      ) {
        res.status(403).json({
          error: '首次登录必须先修改密码',
          code: 'PASSWORD_CHANGE_REQUIRED',
        })
        return
      }
      if (req.auth?.role !== 'sys_admin') {
        const requested = collectRequestedCustomerScopes(req.body)
        for (const id of requested.ids) if (!assertCustomerId(req, res, id)) return
        for (const code of requested.codes) if (!assertCustomerCode(req, res, code)) return
        const customerPathMatch =
          req.path.match(/\/customers\/([^/]+)/)
          || req.path.match(/\/by-customer\/([^/]+)/)
        if (
          customerPathMatch
          && !assertCustomerCode(req, res, decodeURIComponent(customerPathMatch[1]))
        ) return
        if (
          req.method !== 'GET'
          && (
            req.path.startsWith('/accounts')
            || req.path.startsWith('/fee-templates')
            || req.path.startsWith('/payment-methods')
          )
        ) {
          res.status(403).json({ error: 'System administrator access required' })
          return
        }
        const resourceMatch = req.path.match(/^\/erp\/(inbound|outbound|returns)\/([^/]+)/)
        if (resourceMatch && resourceMatch[2] !== 'by-customer') {
          const resourceNo = decodeURIComponent(resourceMatch[2])
          const owner = resourceMatch[1] === 'inbound'
            ? await prisma.inboundOrder.findFirst({
                where: { inboundNo: resourceNo },
                select: { customerId: true },
              })
            : resourceMatch[1] === 'outbound'
              ? await prisma.outboundOrder.findFirst({
                  where: { outboundNo: resourceNo },
                  select: { customerId: true },
                })
              : await prisma.returnOrder.findFirst({
                  where: { returnNo: resourceNo },
                  select: { customerId: true },
                })
          if (!owner || owner.customerId !== req.auth!.customerId) {
            res.status(404).json({ error: 'Resource not found' })
            return
          }
        }
      }
      next()
    } catch (error) {
      console.error('[api authorization]', error)
      if (!res.headersSent) {
        res.status(503).json({ error: 'Authorization service unavailable' })
      }
    }
  })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, erpApiBase: getErpApiBase() })
})

app.get('/api/bootstrap', async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await buildBootstrap(req.auth!))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

/** 轮询刷新系统消息（Webhook 落库后前端拉取） */
app.get('/api/system-messages', async (req: AuthenticatedRequest, res) => {
  try {
    const rows = req.auth?.role === 'sys_admin'
      ? await prisma.systemMessage.findMany({ orderBy: { createdAt: 'desc' } })
      : await prisma.systemMessage.findMany({
          where: {
            OR: [
              { customerId: null },
              { customerId: req.auth!.customerId },
            ],
          },
          orderBy: { createdAt: 'desc' },
        })
    res.json(rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.patch('/api/system-messages/read', async (req, res) => {
  try {
    const scope = customerScope(req as AuthenticatedRequest)
    const scopedWhere = scope
      ? { OR: [{ customerId: null }, { customerId: scope }] }
      : {}
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id: unknown) => String(id)).filter(Boolean)
      : []
    if (req.body?.all === true) {
      const result = await prisma.systemMessage.updateMany({
        where: { read: false, ...scopedWhere },
        data: { read: true },
      })
      res.json({ ok: true, count: result.count })
      return
    }
    if (ids.length === 0) {
      res.status(400).json({ error: '请选择要标记的消息' })
      return
    }
    const result = await prisma.systemMessage.updateMany({
      where: { id: { in: ids }, ...scopedWhere },
      data: { read: true },
    })
    res.json({ ok: true, count: result.count })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

function sendErpError(res: express.Response, e: unknown) {
  if (e instanceof ErpApiError) {
    return res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({
      error: e.message,
      erp: e.body ?? null,
    })
  }
  console.error(e)
  return res.status(500).json({ error: String(e) })
}

function mapAnnouncementType(raw?: string): string {
  const t = String(raw || '').toLowerCase()
  if (t.includes('重要') || t === 'important') return 'important'
  if (t.includes('系统') || t === 'system') return 'system'
  return 'notice'
}

/** P0：货盘目录（ERP 真相源） */
app.get('/api/erp/catalog', async (_req, res) => {
  try {
    res.json(await fetchErpCatalog())
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/catalog/:sku', async (req, res) => {
  try {
    res.json(await fetchErpCatalogSku(req.params.sku))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P0：货盘申购 → ERP 扣余额 / 记持有库存 */
app.post('/api/erp/purchase', async (req, res) => {
  try {
    const body = req.body as {
      orderNo?: string
      customerCode?: string
      customerId?: string
      sku?: string
      quantity?: number
      unitPrice?: number
    }

    let customerCode = (req as AuthenticatedRequest).auth?.role === 'sys_admin'
      ? String(body.customerCode || '').trim()
      : (req as AuthenticatedRequest).auth?.customerCode || ''
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code?.trim() || ''
    }
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode 或可解析的 customerId' })

    const sku = String(body.sku || '').trim()
    const quantity = Math.floor(Number(body.quantity))
    if (!sku) return res.status(400).json({ error: '缺少 sku' })
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: '购买数量须大于 0' })

    const orderNo =
      String(body.orderNo || '').trim() ||
      `CAT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Date.now().toString().slice(-6)}`

    const result = await purchaseErpCatalog({
      orderNo,
      customerCode,
      sku,
      quantity,
      unitPrice: body.unitPrice != null ? Number(body.unitPrice) : undefined,
    })

    let productName = result.sku
    try {
      const catalogSku = await fetchErpCatalogSku(result.sku)
      productName = catalogSku.productName || result.sku
    } catch {
      /* keep sku as name */
    }

    // 本地镜像：申购记录 + 客户货盘锁定库存，便于库存页/出库页继续用
    const account = await prisma.customerAccount.findFirst({ where: { code: customerCode } })
    const customerId = account?.id ?? String(body.customerId || '')
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const erpHoldings = await fetchErpSkuInventoryByCode(customerCode).catch(() => [])
    const canonicalHolding = erpHoldings.find(item => item.sku === result.sku)
    const canonicalQuantity = canonicalHolding?.quantity

    if (customerId) {
      await prisma.catalogPurchase.create({
        data: {
          id: `erp-${result.id}`,
          purchaseNo: result.orderNo,
          customerId,
          sku: result.sku,
          productName,
          qty: result.quantity,
          createdAt: now,
        },
      }).catch(() => undefined)

      const mirrorId = `csi-${customerId}-${result.sku}`
      const existing = await prisma.inventoryItem.findFirst({
        where: { sku: result.sku, stockSource: 'catalog', customerId },
      }) ?? await prisma.inventoryItem.findUnique({ where: { id: mirrorId } })
      if (existing) {
        await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: {
            sku: result.sku,
            customerId,
            stockSource: 'catalog',
            locked:
              canonicalQuantity ??
              (result.idempotent ? existing.locked : existing.locked + result.quantity),
          },
        })
      } else {
        const pool = await prisma.inventoryItem.findFirst({
          where: {
            sku: result.sku,
            stockSource: 'catalog',
            OR: [{ customerId: null }, { customerId: 'tkl' }],
          },
        })
        await prisma.inventoryItem.create({
          data: {
            id: mirrorId,
            customerId,
            sku: result.sku,
            name: pool?.name || productName,
            image: pool?.image || '',
            available: 0,
            locked: canonicalQuantity ?? result.quantity,
            inTransit: 0,
            safetyStock: 0,
            spec: pool?.spec || '',
            customCode: pool?.customCode ?? null,
            ean: pool?.ean ?? null,
            warehouse: pool?.warehouse || account?.warehouse || 'jhb1',
            pendingShelving: 0,
            pendingOutbound: 0,
            defective: 0,
            shipped: 0,
            warningQty: 0,
            price: result.unitPrice,
            declaredNameEn: pool?.declaredNameEn ?? null,
            categoryPath: pool?.categoryPath ?? null,
            stockSource: 'catalog',
          },
        })
      }

      // 同步默认账单余额（演示页）
      await prisma.billingAccount.updateMany({
        where: { customerId },
        data: { creditBalance: result.balanceAfter ?? 0 },
      })
    }

    res.json(result)
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P0：客户主数据 + 余额 */
app.get('/api/erp/customers/:customerCode', async (req, res) => {
  try {
    res.json(await fetchErpCustomerByCode(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/customers/:customerCode/sku-inventory', async (req, res) => {
  try {
    res.json(await fetchErpSkuInventoryByCode(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/customers/:customerCode/balance', async (req, res) => {
  try {
    const customer = await fetchErpCustomerByCode(req.params.customerCode)
    const account = await prisma.customerAccount.findFirst({
      where: { code: customer.customerCode },
      select: { id: true },
    })
    if (account) {
      await prisma.billingAccount.updateMany({
        where: { customerId: account.id },
        data: { creditBalance: customer.balance },
      })
    }
    res.json({
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      balance: customer.balance,
      status: customer.statusLabel,
    })
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/customers/:customerCode/inventory-view', async (req, res) => {
  try {
    const warehouseCode = typeof req.query.warehouseCode === 'string' ? req.query.warehouseCode : undefined
    res.json(await fetchErpInventoryView(req.params.customerCode, warehouseCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P2：费用明细 */
app.get('/api/erp/customers/:customerCode/charges', async (req, res) => {
  try {
    res.json(await fetchErpCharges(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P2：账单列表 */
app.get('/api/erp/customers/:customerCode/bills', async (req, res) => {
  try {
    res.json(await fetchErpBills(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P2：充值 */
app.post('/api/erp/customers/:customerCode/recharge', async (req, res) => {
  try {
    const body = req.body as {
      amount?: number
      paymentMethod?: string
      paymentMethodId?: string
      paymentMethodTitle?: string
      remark?: string
      rechargeNo?: string
    }
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: '充值金额无效' })
    }
    const result = await createErpRecharge(req.params.customerCode, {
      amount,
      paymentMethod: body.paymentMethod || body.paymentMethodId || 'bank',
      paymentMethodTitle: body.paymentMethodTitle,
      remark: body.remark,
      rechargeNo: body.rechargeNo,
    })

    const account = await prisma.customerAccount.findFirst({ where: { code: req.params.customerCode } })
    if (account) {
      await prisma.billingAccount.updateMany({
        where: { customerId: account.id },
        data: { creditBalance: result.balance },
      })
    }
    const feeId = `erp-rc-${result.record.rechargeNo}`
    const existingFee = await prisma.feeRecord.findUnique({ where: { id: feeId } })
    if (!existingFee) {
      await prisma.feeRecord.create({
        data: {
          id: feeId,
          date: new Date().toISOString().slice(0, 10),
          type: 'recharge',
          refNo: result.record.rechargeNo,
          desc: `充值到账 · ${body.paymentMethodTitle || result.record.paymentMethod || 'bank'}`,
          amount: result.record.amount,
          method: 'actual',
          customerCode: result.customerCode,
          rechargeNo: result.record.rechargeNo,
          paymentMethodId: body.paymentMethodId || body.paymentMethod || null,
          paymentMethodTitle: body.paymentMethodTitle || result.record.paymentMethod || null,
        },
      })
    }

    res.json(result)
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/customers/:customerCode/recharges', async (req, res) => {
  try {
    res.json(await fetchErpRecharges(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P2：公告 */
app.get('/api/erp/announcements', async (_req, res) => {
  try {
    res.json(await fetchErpAnnouncements())
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P2：建品 */
app.post('/api/erp/products', async (req, res) => {
  try {
    const body = req.body as {
      sku?: string
      productName?: string
      name?: string
      customerCode?: string
      customerId?: string
      spec?: string
      category?: string
      brand?: string
      barcode?: string
      lengthCm?: number
      widthCm?: number
      heightCm?: number
      weightKg?: number
      costRmb?: number
      declaredValue?: number
      declaredNameEn?: string
      declaredNameCn?: string
      unit?: string
      remark?: string
    }
    let customerCode = authenticatedCustomerCode(req, body.customerCode)
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code || ''
    }
    const result = await createErpProduct({
      sku: String(body.sku || ''),
      productName: String(body.productName || body.name || ''),
      customerCode: customerCode || undefined,
      spec: body.spec,
      category: body.category,
      brand: body.brand,
      barcode: body.barcode,
      lengthCm: body.lengthCm,
      widthCm: body.widthCm,
      heightCm: body.heightCm,
      weightKg: body.weightKg,
      costRmb: body.costRmb,
      declaredValue: body.declaredValue,
      declaredNameEn: body.declaredNameEn,
      declaredNameCn: body.declaredNameCn,
      unit: body.unit,
      remark: body.remark,
    })
    res.json(result)
  } catch (e) {
    sendErpError(res, e)
  }
})

/**
 * ERP → OMS 状态回传（到仓/上架/发运/送达等）
 * ERP 配置 OMS_WEBHOOK_URL 指向本接口
 */
app.post('/api/erp/webhooks/events', async (req, res) => {
  try {
    const body = req.body as {
      eventId?: string
      type?: string
      customerCode?: string
      data?: Record<string, unknown>
    }
    const rawBody =
      (req as express.Request & { rawBody?: Buffer }).rawBody ??
      Buffer.from(JSON.stringify(req.body))
    const signature = String(req.header('x-oms-signature') || '')
    if (!validWebhookSignature(rawBody, signature)) {
      return res.status(WEBHOOK_SECRET ? 401 : 503).json({
        error: WEBHOOK_SECRET ? 'Webhook 签名无效' : '生产环境未配置 OMS_WEBHOOK_SECRET',
      })
    }
    const eventId = String(body.eventId || req.header('x-oms-event-id') || '').trim()
    if (!eventId) return res.status(400).json({ error: '缺少 eventId' })
    const type = String(body.type || '')
    const customerCode = String(body.customerCode || '').trim()
    const data = body.data || {}
    if (!type) {
      return res.status(400).json({ error: '缺少 type' })
    }
    // 公告可广播 customerCode='*'；其余事件必须带客户编码
    if (!customerCode && type !== 'announcement.publish') {
      return res.status(400).json({ error: '缺少 customerCode' })
    }

    const payloadHash = createHash('sha256').update(rawBody).digest('hex')
    const existingEvent = await prisma.webhookEvent.findUnique({ where: { eventId } })
    if (existingEvent?.payloadHash !== undefined && existingEvent.payloadHash !== payloadHash) {
      return res.status(409).json({ error: 'eventId 对应的 payload 不一致' })
    }
    if (existingEvent?.status === 'processed') {
      return res.json({ ok: true, type, customerCode, eventId, alreadyProcessed: true })
    }
    if (!existingEvent) {
      await prisma.webhookEvent.create({
        data: {
          eventId,
          eventType: type,
          customerCode: customerCode || null,
          payloadHash,
          status: 'pending',
        },
      })
    }
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void prisma.webhookEvent.update({
          where: { eventId },
          data: { status: 'processed', processedAt: new Date() },
        }).catch(error => console.error('[webhook] mark processed failed', error))
      }
    })

    const account =
      customerCode && customerCode !== '*'
        ? await prisma.customerAccount.findFirst({ where: { code: customerCode } })
        : null
    const customerId = account?.id

    if (type === 'announcement.publish') {
      const ann = data as {
        id?: number
        title?: string
        content?: string
        date?: string
        type?: string
        category?: string
      }
      const id = `erp-ann-${ann.id ?? Date.now()}`
      const title = String(ann.title || '系统公告')
      const date = String(ann.date || new Date().toISOString().slice(0, 10))
      const annType = mapAnnouncementType(ann.type || ann.category)
      const existing = await prisma.announcement.findUnique({ where: { id } })
      if (existing) {
        await prisma.announcement.update({ where: { id }, data: { title, date, type: annType } })
      } else {
        await prisma.announcement.create({ data: { id, title, date, type: annType } })
      }
      const msgId = `erp-msg-ann-${ann.id ?? Date.now()}`
      const msgExisting = await prisma.systemMessage.findUnique({ where: { id: msgId } })
      if (!msgExisting) {
        await prisma.systemMessage.create({
          data: {
            id: msgId,
            customerId: account?.id ?? null,
            title: `公告：${title}`,
            content: String(ann.content || title).slice(0, 2000),
            type: 'system',
            read: false,
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          },
        })
      }
      return res.json({ ok: true, type, customerCode: customerCode || '*' })
    }

    if (type === 'billing.changed' || type === 'balance.changed') {
      if (!account) {
        return res.status(400).json({ error: `OMS 无客户账户 ${customerCode}` })
      }
      const billingPayload = { ...(data as Record<string, unknown>) }
      if (type === 'balance.changed' && data.rechargeNo) {
        billingPayload.recharges = [
          {
            rechargeNo: String(data.rechargeNo),
            amount: Number(data.amount || 0),
            paymentMethod: String(data.paymentMethod || 'bank'),
            remark: data.remark ? String(data.remark) : null,
            createdAt: new Date().toISOString().slice(0, 10),
          },
        ]
      }
      const applied = await applyErpBillingChanged(
        prisma,
        customerCode,
        account,
        billingPayload as ErpBillingChangedPayload,
      )
      if (!applied.ok) return res.status(400).json({ error: applied.error })
      if (type === 'billing.changed') {
        const billingNo = String(data.billingNo || '')
        if (billingNo) {
          const msgId = `erp-msg-bill-${billingNo}`
          const existingMsg = await prisma.systemMessage.findUnique({ where: { id: msgId } })
          if (!existingMsg) {
            await prisma.systemMessage.create({
              data: {
                id: msgId,
                customerId: account.id,
                title: `账单 ${billingNo} 已确认`,
                content: `金额 ¥${Number(data.totalAmount || 0).toFixed(2)}，状态：${String(data.status || 'confirmed')}`,
                type: 'billing',
                read: false,
                createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
              },
            })
          }
        }
      }
      return res.json({ ok: true, type, customerCode })
    }

    if (type === 'outbound.fees') {
      const payload = data as unknown as OutboundFeesPayload
      if (!payload.outboundNo) return res.status(400).json({ error: '缺少 outboundNo' })
      const result = await settleOutboundFees(prisma, customerCode, account?.id ?? null, payload)
      if ('error' in result) return res.status(400).json({ error: result.error })
      return res.json({ ok: true, type, customerCode, settlementDelta: result.settlementDelta })
    }

    if (type === 'outbound.refund') {
      const outboundNo = String(data.outboundNo || '')
      if (!outboundNo) return res.status(400).json({ error: '缺少 outboundNo' })
      const result = await refundOutboundPreDeduct(prisma, customerCode, account?.id ?? null, {
        outboundNo,
        preDeductTotal: Number(data.preDeductTotal) || 0,
        balance: data.balance == null ? null : Number(data.balance),
        reason: String(data.reason || ''),
      })
      if ('error' in result) return res.status(400).json({ error: result.error })
      return res.json({ ok: true, type, customerCode })
    }

    if (type === 'inbound.status') {
      const inbound = data as unknown as ErpInboundOrder
      if (!inbound.inboundNo) return res.status(400).json({ error: '缺少 inboundNo' })
      const existing = await prisma.inboundOrder.findFirst({ where: { inboundNo: inbound.inboundNo } })
      const status = inbound.omsStatus || 'on_the_way'
      const totalQty = inbound.totalExpectedQty ?? 0
      const receivedQty = inbound.totalReceivedQty ?? 0
      const lineItems = JSON.stringify(
        (inbound.items || []).map(i => ({
          sku: i.sku,
          name: (i as { productName?: string }).productName || i.sku,
          qty: i.expectedQty,
          boxNo: 1,
          packType: '自带包装',
          stockType: '以仓库为准',
        })),
      )
      const payload = {
        status,
        receivedQty,
        totalQty: totalQty || existing?.totalQty || 0,
        trackingNo: inbound.trackingNo ?? existing?.trackingNo,
        warehouse: toOmsWarehouseCode(inbound.warehouseCode, existing?.warehouse),
        source: inbound.source || existing?.source,
        inboundType: inbound.inboundType || existing?.inboundType,
        deliveryMethod: inbound.deliveryMethod || existing?.deliveryMethod,
        stockSource: inbound.stockSource || existing?.stockSource,
        referenceNo: inbound.referenceNo || existing?.referenceNo,
        eta: inbound.eta || existing?.eta,
        contact: inbound.contact || existing?.contact,
        contactPhone: inbound.contactPhone || existing?.contactPhone,
        remark: inbound.remark ?? existing?.remark,
        lineItems,
      }
      if (existing) {
        await prisma.inboundOrder.update({
          where: { id: existing.id },
          data: payload,
        })
      } else {
        await prisma.inboundOrder.create({
          data: {
            id: `erp-ib-${inbound.id}`,
            customerId: customerId ?? null,
            inboundNo: inbound.inboundNo,
            source: inbound.source || 'ERP回传',
            inboundType: inbound.inboundType || '自发头程',
            deliveryMethod: inbound.deliveryMethod || 'self',
            stockSource: inbound.stockSource || 'owned',
            boxCount: Math.max(1, inbound.items?.length || 1),
            skuCount: inbound.items?.length || 0,
            totalQty,
            receivedQty,
            status,
            createdAt: new Date().toISOString().slice(0, 10),
            warehouse: toOmsWarehouseCode(inbound.warehouseCode, existing?.warehouse || 'jhb1'),
            referenceNo: inbound.referenceNo,
            eta: inbound.eta,
            contact: inbound.contact,
            contactPhone: inbound.contactPhone,
            trackingNo: inbound.trackingNo,
            remark: inbound.remark,
            lineItems,
          },
        })
      }
    } else if (type === 'outbound.status') {
      const outbound = data as unknown as ErpOutboundOrder
      if (!outbound.outboundNo) return res.status(400).json({ error: '缺少 outboundNo' })
      const existing = await prisma.outboundOrder.findFirst({ where: { outboundNo: outbound.outboundNo } })
      const status = outbound.omsStatus || 'locked'
      const totalQty = outbound.items?.reduce((s, i) => s + i.qty, 0) || 0
      const lineItems = JSON.stringify(
        (outbound.items || []).map(i => ({
          sku: i.sku,
          name: i.productName || i.sku,
          qty: i.qty,
        })),
      )
      const payload = {
        status,
        trackingNo: outbound.trackingNo ?? existing?.trackingNo,
        totalQty: totalQty || existing?.totalQty,
        items: outbound.items?.length || existing?.items,
        lineItems,
        destination: outbound.destination || existing?.destination,
        shippingMethod: outbound.shippingMethod || existing?.shippingMethod,
        source: outbound.source || existing?.source,
        stockSource: outbound.stockSource || existing?.stockSource,
        refNo: outbound.fbaNo || existing?.refNo,
        orderNo: outbound.orderNo || existing?.orderNo,
        sellerStoreName: outbound.sellerStoreName || existing?.sellerStoreName,
        takealotSellerId: outbound.takealotSellerId || existing?.takealotSellerId,
        takealotBookingRef: outbound.takealotBookingRef || existing?.takealotBookingRef,
        shipmentDueDate: outbound.shipmentDueDate || existing?.shipmentDueDate,
        scheduledDeliveryDate: outbound.appointmentDate || existing?.scheduledDeliveryDate,
        recipient: outbound.recipient ? JSON.stringify(outbound.recipient) : existing?.recipient,
        remark: outbound.remark ?? existing?.remark,
        destRegion: outbound.preDeduct?.destRegion ?? outbound.destRegion ?? existing?.destRegion,
        priceTemplateId: outbound.preDeduct?.priceTemplateId ?? existing?.priceTemplateId,
        priceTemplateName: outbound.preDeduct?.priceTemplateName ?? existing?.priceTemplateName,
        preDeductTotal: outbound.preDeduct?.preDeductTotal ?? existing?.preDeductTotal,
        preDeductVolumeM3: outbound.preDeduct?.totalVolumeM3 ?? existing?.preDeductVolumeM3,
        preDeductWeightKg: outbound.preDeduct?.totalWeightKg ?? existing?.preDeductWeightKg,
        preDeductSnapshot: outbound.preDeduct ? JSON.stringify(outbound.preDeduct) : existing?.preDeductSnapshot,
        measureSnapshot: outbound.measure ? JSON.stringify(outbound.measure) : existing?.measureSnapshot,
        actualFeesSnapshot: outbound.actualFees ? JSON.stringify(outbound.actualFees) : existing?.actualFeesSnapshot,
        actualFeesTotal: outbound.actualFees?.actualTotal ?? existing?.actualFeesTotal ?? undefined,
        measuredVolumeM3: outbound.measure?.totalVolumeM3 ?? existing?.measuredVolumeM3 ?? undefined,
        measuredWeightKg: outbound.measure?.totalWeightKg ?? existing?.measuredWeightKg ?? undefined,
      }
      if (existing) {
        await prisma.outboundOrder.update({
          where: { id: existing.id },
          data: payload,
        })
      } else {
        await prisma.outboundOrder.create({
          data: {
            id: `erp-ob-${outbound.id}`,
            customerId: customerId ?? null,
            outboundNo: outbound.outboundNo,
            source: outbound.source || 'catalog_dist',
            stockSource: outbound.stockSource || 'catalog',
            type: outbound.platform === 'Takealot' ? 'takealot' : 'dropship',
            warehouse: 'jhb1',
            items: outbound.items?.length || 1,
            totalQty,
            status,
            destination: outbound.destination || '—',
            createdAt: new Date().toISOString().slice(0, 10),
            trackingNo: outbound.trackingNo,
            shippingMethod: outbound.shippingMethod,
            refNo: outbound.fbaNo,
            orderNo: outbound.orderNo,
            sellerStoreName: outbound.sellerStoreName,
            takealotSellerId: outbound.takealotSellerId,
            takealotBookingRef: outbound.takealotBookingRef,
            shipmentDueDate: outbound.shipmentDueDate,
            scheduledDeliveryDate: outbound.appointmentDate,
            recipient: outbound.recipient ? JSON.stringify(outbound.recipient) : null,
            remark: outbound.remark,
            destRegion: outbound.preDeduct?.destRegion ?? outbound.destRegion ?? null,
            priceTemplateId: outbound.preDeduct?.priceTemplateId ?? null,
            priceTemplateName: outbound.preDeduct?.priceTemplateName ?? null,
            preDeductTotal: outbound.preDeduct?.preDeductTotal ?? null,
            preDeductVolumeM3: outbound.preDeduct?.totalVolumeM3 ?? null,
            preDeductWeightKg: outbound.preDeduct?.totalWeightKg ?? null,
            preDeductSnapshot: outbound.preDeduct ? JSON.stringify(outbound.preDeduct) : null,
            measureSnapshot: outbound.measure ? JSON.stringify(outbound.measure) : null,
            actualFeesSnapshot: outbound.actualFees ? JSON.stringify(outbound.actualFees) : null,
            lineItems,
          },
        })
      }
    } else if (type === 'inventory.changed') {
      const payload = data as {
        action?: string
        sku?: string
        quantity?: number
        remainingQty?: number
        reason?: string
        stockSource?: string
        items?: { sku: string; qty: number }[]
      }
      if (payload.action === 'catalog_reclaim' && customerId && payload.sku && payload.quantity) {
        const sku = String(payload.sku).trim()
        const qty = Math.floor(Number(payload.quantity))
        if (qty > 0) {
          const inv = await prisma.inventoryItem.findFirst({
            where: { customerId, sku, stockSource: 'catalog' },
          })
          if (inv) {
            const nextLocked = Math.max(0, inv.locked - qty)
            if (nextLocked <= 0) {
              await prisma.inventoryItem.delete({ where: { id: inv.id } }).catch(() => undefined)
            } else {
              await prisma.inventoryItem.update({
                where: { id: inv.id },
                data: { locked: nextLocked },
              })
            }
          }
          const product = await prisma.product.findFirst({ where: { internalSku: sku } })
          if (product) {
            await prisma.product.update({
              where: { id: product.id },
              data: {
                lockedQty: Math.max(0, product.lockedQty - qty),
                availableQty: Math.max(0, product.availableQty - qty),
                ...(payload.remainingQty === 0 ? { inCatalog: true, productStatus: 'draft' } : {}),
              },
            })
          }
        }
      }
      if (
        customerId &&
        payload.stockSource === 'catalog' &&
        (payload.reason === 'outbound_shipped' || payload.reason === 'outbound_cancelled')
      ) {
        for (const line of payload.items || []) {
          const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
          if (!qty) continue
          const inv = await prisma.inventoryItem.findFirst({
            where: { customerId, sku: String(line.sku), stockSource: 'catalog' },
          })
          if (!inv) continue
          await prisma.inventoryItem.update({
            where: { id: inv.id },
            data: payload.reason === 'outbound_cancelled'
              ? {
                  locked: inv.locked + qty,
                  pendingOutbound: Math.max(0, inv.pendingOutbound - qty),
                }
              : {
                  pendingOutbound: Math.max(0, inv.pendingOutbound - qty),
                  shipped: inv.shipped + qty,
                },
          })
        }
      }
      if (customerId) {
        await prisma.systemMessage.create({
          data: {
            id: `erp-inv-${Date.now()}`,
            customerId,
            title: '库存已更新',
            content: `ERP 库存变更：${String((data as { reason?: string }).reason || 'sync')}`,
            type: 'inventory',
            read: false,
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          },
        }).catch(() => undefined)
      }
    } else if (type === 'return.status') {
      const ret = data as unknown as ErpReturnOrder
      if (!ret.returnNo) return res.status(400).json({ error: '缺少 returnNo' })
      const existing = await prisma.returnOrder.findFirst({ where: { returnNo: ret.returnNo } })
      const lineItems = JSON.stringify(
        (ret.items || []).map(i => ({
          sku: i.sku,
          name: i.productName || i.sku,
          qty: i.quantity,
        })),
      )
      const totalQty = ret.totalQty ?? (ret.items || []).reduce((s, i) => s + i.quantity, 0)
      const payload = {
        orderNo: ret.orderNo,
        referenceNo: ret.referenceNo || null,
        trackingNo: ret.trackingNo || null,
        sellerStoreName: ret.sellerStoreName || null,
        sellerTaxNo: ret.sellerTaxNo || null,
        returnWarehouse: ret.returnWarehouse || null,
        expectedArrivalAt: ret.expectedArrivalAt
          ? String(ret.expectedArrivalAt).slice(0, 19).replace('T', ' ')
          : null,
        returnReason: ret.returnReason,
        returnDescription: ret.returnDescription || null,
        requestedProcess: ret.requestedProcess,
        status: ret.status,
        processResult: ret.processResult || null,
        processRemark: ret.processRemark || null,
        receivedAt: ret.receivedAt?.slice(0, 19).replace('T', ' ') ?? null,
        processedAt: ret.processedAt?.slice(0, 19).replace('T', ' ') ?? null,
        estimatedFeeTotal: ret.estimatedFeeTotal != null ? String(ret.estimatedFeeTotal) : null,
        totalVolumeCbm: ret.totalVolumeCbm != null ? String(ret.totalVolumeCbm) : null,
        inspectionResult: ret.inspectionResult || null,
        inspectionRemark: ret.inspectionRemark || null,
        customerDecision: ret.customerDecision || null,
        customerDecidedAt: ret.customerDecidedAt?.slice(0, 19).replace('T', ' ') ?? null,
        customerProcessChoice: ret.customerProcessChoice || null,
        lineItems,
        remark: existing?.remark ?? null,
      }
      if (existing) {
        await prisma.returnOrder.update({
          where: { id: existing.id },
          data: {
            ...payload,
            ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
          },
        })
      } else {
        await prisma.returnOrder.create({
          data: {
            id: `erp-rt-${ret.id}`,
            returnNo: ret.returnNo,
            createdAt: ret.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
            ...payload,
            ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
          },
        })
      }
    } else if (type === 'logistics.update') {
      const lg = data as {
        id?: string
        refNo?: string
        outboundNo?: string
        carrier?: string
        trackingNo?: string
        status?: string
        destination?: string
        updatedAt?: string
        podStatus?: string
        podCode?: string | null
        podFileName?: string | null
        podUploadedAt?: string | null
        exceptionReason?: string
      }
      const outboundNo = String(lg.outboundNo || '')
      if (!outboundNo) return res.status(400).json({ error: '缺少 outboundNo' })
      const id = String(lg.id || `lg-erp-${outboundNo}`)
      const existing = await prisma.logisticsRecord.findFirst({
        where: { OR: [{ id }, { outboundNo }] },
      })
      const row = {
        refNo: String(lg.refNo || outboundNo),
        outboundNo,
        carrier: String(lg.carrier || '—'),
        trackingNo: String(lg.trackingNo || '—'),
        status: String(lg.status || 'in_transit'),
        destination: String(lg.destination || '—'),
        updatedAt: String(lg.updatedAt || new Date().toISOString().slice(0, 19).replace('T', ' ')),
        podStatus: String(lg.podStatus || existing?.podStatus || 'pending'),
        podCode: lg.podCode !== undefined
          ? (lg.podCode ? String(lg.podCode) : null)
          : (existing?.podCode ?? null),
        exceptionReason: lg.exceptionReason ?? existing?.exceptionReason ?? null,
      }
      if (existing) {
        await prisma.logisticsRecord.update({
          where: { id: existing.id },
          data: {
            ...row,
            podFileName: lg.podFileName !== undefined
              ? (lg.podFileName ? String(lg.podFileName) : null)
              : existing.podFileName,
            podUploadedAt: lg.podUploadedAt !== undefined
              ? (lg.podUploadedAt ? String(lg.podUploadedAt) : null)
              : existing.podUploadedAt,
            podFileUrl: existing.podFileUrl,
          },
        })
      } else {
        await prisma.logisticsRecord.create({ data: { id, ...row } })
      }
    }

    res.json({ ok: true, type, customerCode })
  } catch (e) {
    console.error('[webhook]', e)
    res.status(500).json({ error: String(e) })
  }
})

/** P1：预约入库 ASN */
app.post('/api/erp/inbound', async (req, res) => {
  try {
    const body = req.body as {
      inboundNo?: string
      customerCode?: string
      customerId?: string
      warehouseCode?: string
      trackingNo?: string
      remark?: string
      source?: string
      inboundType?: string
      deliveryMethod?: string
      stockSource?: string
      referenceNo?: string
      eta?: string
      contact?: string
      contactPhone?: string
      items?: { sku: string; qty: number; productName?: string; boxNo?: number }[]
      attachments?: { fileName: string; contentBase64: string; fileType?: string; url?: string }[]
    }
    let customerCode = authenticatedCustomerCode(req, body.customerCode)
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code?.trim() || ''
    }
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })

    const attachments = (body.attachments || []).map(a => {
      let contentBase64 = a.contentBase64
      if (!contentBase64 && a.url?.startsWith('data:')) {
        contentBase64 = a.url.split(',')[1] || ''
      }
      return {
        fileType: a.fileType || 'other',
        fileName: a.fileName,
        contentBase64: contentBase64 || '',
      }
    }).filter(a => a.fileName && a.contentBase64)

    const result = await createErpInboundAsn({
      inboundNo: body.inboundNo,
      customerCode,
      warehouseCode: body.warehouseCode || 'WMS-JHB-01',
      trackingNo: body.trackingNo,
      remark: body.remark,
      source: body.source,
      inboundType: body.inboundType,
      deliveryMethod: body.deliveryMethod,
      stockSource: body.stockSource,
      referenceNo: body.referenceNo,
      eta: body.eta,
      contact: body.contact,
      contactPhone: body.contactPhone,
      items: body.items || [],
      attachments,
    })
    res.json(result)
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/inbound/by-customer/:customerCode', async (req, res) => {
  try {
    res.json(await fetchErpInboundsByCustomer(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/inbound/:inboundNo', async (req, res) => {
  try {
    res.json(await fetchErpInboundByNo(req.params.inboundNo))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** 退件：OMS 预约 → ERP */
app.post('/api/erp/returns', async (req, res) => {
  try {
    const body = req.body as {
      returnNo?: string
      customerCode?: string
      customerId?: string
      orderNo?: string
      referenceNo?: string
      trackingNo?: string
      sellerStoreName?: string
      sellerTaxNo?: string
      returnWarehouse?: string
      expectedArrivalAt?: string
      returnReason?: string
      returnDescription?: string
      requestedProcess?: string
      remark?: string
      attachments?: { fileType?: string; fileName: string; contentBase64?: string; url?: string }[]
      items?: { sku: string; quantity: number; productName?: string }[]
    }
    let customerCode = authenticatedCustomerCode(req, body.customerCode)
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code?.trim() || ''
    }
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })
    const returnWarehouse = String(body.returnWarehouse || '').trim().toUpperCase()
    if (!['JHB3', 'CPT2', 'DBN'].includes(returnWarehouse)) {
      return res.status(400).json({ error: '请选择退件仓库（JHB3 / CPT2 / DBN）' })
    }
    const attachments = (body.attachments || []).map(a => {
      let contentBase64 = a.contentBase64
      if (!contentBase64 && a.url?.startsWith('data:')) {
        contentBase64 = a.url.split(',')[1] || ''
      }
      return {
        fileType: a.fileType || 'return_doc',
        fileName: a.fileName,
        contentBase64: contentBase64 || '',
      }
    }).filter(a => a.fileName && a.contentBase64)
    const result = await createErpReturn({
      returnNo: body.returnNo,
      customerCode,
      orderNo: String(body.orderNo || ''),
      referenceNo: body.referenceNo,
      trackingNo: body.trackingNo,
      sellerStoreName: body.sellerStoreName,
      sellerTaxNo: body.sellerTaxNo,
      returnWarehouse,
      expectedArrivalAt: body.expectedArrivalAt,
      returnReason: String(body.returnReason || ''),
      returnDescription: body.returnDescription,
      requestedProcess: String(body.requestedProcess || ''),
      remark: body.remark,
      attachments,
      items: body.items || [],
    })
    res.json(result)
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/returns/by-customer/:customerCode', async (req, res) => {
  try {
    res.json(await fetchErpReturnsByCustomer(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.post('/api/erp/returns/:returnNo/cancel', async (req, res) => {
  try {
    const returnNo = String(req.params.returnNo || '').trim()
    const body = req.body as { customerCode?: string; customerId?: string }
    let customerCode = authenticatedCustomerCode(req, body.customerCode)
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code?.trim() || ''
    }
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })
    res.json(await cancelErpReturnApi(returnNo, customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.post('/api/erp/returns/:returnNo/decide', async (req, res) => {
  try {
    const returnNo = String(req.params.returnNo || '').trim()
    const body = req.body as {
      customerCode?: string
      customerId?: string
      decision?: 'keep' | 'discard'
      processChoice?: string
    }
    let customerCode = authenticatedCustomerCode(req, body.customerCode)
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code?.trim() || ''
    }
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })
    if (body.decision !== 'keep' && body.decision !== 'discard') {
      return res.status(400).json({ error: 'decision 须为 keep 或 discard' })
    }
    res.json(await decideErpReturnApi(returnNo, {
      customerCode,
      decision: body.decision,
      processChoice: body.processChoice,
    }))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/returns/:returnNo/attachment/:attachmentId', async (req, res) => {
  try {
    const customerCode = authenticatedCustomerCode(
      req,
      typeof req.query.customerCode === 'string' ? req.query.customerCode : undefined,
    )
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })
    const file = await downloadErpReturnAttachment(
      String(req.params.returnNo),
      Number(req.params.attachmentId),
      customerCode,
    )
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/returns/:returnNo', async (req, res) => {
  try {
    res.json(await fetchErpReturnByNo(req.params.returnNo))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** P1：预约出库 */
app.post('/api/erp/outbound', async (req, res) => {
  try {
    const body = req.body as {
      outboundNo?: string
      customerCode?: string
      customerId?: string
      warehouseCode?: string
      platform?: string
      fbaNo?: string
      appointmentDate?: string
      shipmentDueDate?: string
      sellerStoreName?: string
      takealotSellerId?: string
      takealotBookingRef?: string
      remark?: string
      stockSource?: 'catalog' | 'owned'
      destType?: string
      fbaWarehouse?: string
      shippingMethod?: string
      destination?: string
      source?: string
      orderNo?: string
      recipient?: {
        name: string
        province?: string
        city: string
        postalCode: string
        phone: string
        address1: string
        address2?: string
        email?: string
      }
      items?: { sku: string; qty: number; productName?: string }[]
      attachments?: {
        fileType?: string
        fileName: string
        contentBase64?: string
        url?: string
        sku?: string
        platformBarcode?: string
        unitIndex?: number
        sourcePage?: number
        sourceRow?: number
        sourceColumn?: number
        labelRole?: string
        contentHash?: string
      }[]
      preDeduct?: {
        destRegion?: string
        priceTemplateId?: string
        priceTemplateName?: string
        preDeductTotal: number
        totalVolumeM3?: number
        totalWeightKg?: number
        lines: { type: string; label: string; amount: number; detail?: string }[]
        deductedAt?: string
        templateSnapshot?: {
          handling: { perOrderBase: number; perUnit: number; perSkuLine: number }
          shipping: { mode: 'volume' | 'weight'; ratePerCbm?: number; ratePerKg?: number; minCharge: number }
          pickup?: { perOrder: number; perUnit: number; minCharge: number }
          shippingMethod: string
          destRegion: string
        }
      }
    }
    let customerCode = authenticatedCustomerCode(req, body.customerCode)
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code?.trim() || ''
    }
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })

    const attachments = (body.attachments || []).map(a => {
      let contentBase64 = a.contentBase64
      if (!contentBase64 && a.url?.startsWith('data:')) {
        contentBase64 = a.url.split(',')[1] || ''
      }
      return {
        fileType: a.fileType || 'other',
        fileName: a.fileName,
        contentBase64: contentBase64 || '',
        sku: a.sku,
        platformBarcode: a.platformBarcode,
        unitIndex: a.unitIndex,
        sourcePage: a.sourcePage,
        sourceRow: a.sourceRow,
        sourceColumn: a.sourceColumn,
        labelRole: a.labelRole,
        contentHash: a.contentHash,
      }
    }).filter(a => a.fileName && a.contentBase64)

    const result = await createErpOutbound({
      outboundNo: body.outboundNo,
      customerCode,
      warehouseCode: body.warehouseCode || 'WMS-JHB-01',
      platform: body.platform,
      fbaNo: body.fbaNo,
      appointmentDate: body.appointmentDate,
      shipmentDueDate: body.shipmentDueDate,
      sellerStoreName: body.sellerStoreName,
      takealotSellerId: body.takealotSellerId,
      takealotBookingRef: body.takealotBookingRef,
      remark: body.remark,
      stockSource: body.stockSource,
      destType: body.destType,
      fbaWarehouse: body.fbaWarehouse,
      shippingMethod: body.shippingMethod,
      destination: body.destination,
      source: body.source,
      orderNo: body.orderNo,
      recipient: body.recipient,
      items: body.items || [],
      attachments,
      preDeduct: body.preDeduct,
    })
    res.json(result)
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/outbound/by-customer/:customerCode', async (req, res) => {
  try {
    res.json(await fetchErpOutboundsByCustomer(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/outbound/by-customer/:customerCode/sku/:sku/outbounds', async (req, res) => {
  try {
    res.json(await fetchErpSkuOutbounds(req.params.customerCode, req.params.sku))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/outbound/:outboundNo', async (req, res) => {
  try {
    res.json(await fetchErpOutboundByNo(req.params.outboundNo))
  } catch (e) {
    sendErpError(res, e)
  }
})

/** OMS 客户回传 POD 签收单至 ERP */
app.post('/api/erp/outbound/:outboundNo/pod', async (req, res) => {
  try {
    const body = req.body as {
      customerCode?: string
      customerId?: string
      fileName?: string
      contentBase64?: string
      url?: string
    }
    let customerCode = authenticatedCustomerCode(req, body.customerCode)
    if (!customerCode && body.customerId) {
      const account = await prisma.customerAccount.findUnique({ where: { id: String(body.customerId) } })
      customerCode = account?.code?.trim() || ''
    }
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })
    let contentBase64 = body.contentBase64 || ''
    if (!contentBase64 && body.url?.startsWith('data:')) {
      contentBase64 = body.url.split(',')[1] || ''
    }
    if (!body.fileName?.trim() || !contentBase64) {
      return res.status(400).json({ error: '缺少 POD 文件' })
    }
    res.json(await uploadErpPodReceipt(req.params.outboundNo, {
      customerCode,
      fileName: body.fileName.trim(),
      contentBase64,
    }))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/outbound/:outboundNo/pod', async (req, res) => {
  try {
    const customerCode = authenticatedCustomerCode(
      req,
      typeof req.query.customerCode === 'string' ? req.query.customerCode : undefined,
    )
    if (!customerCode) return res.status(400).json({ error: '缺少 customerCode' })
    const file = await downloadErpOutboundPod(String(req.params.outboundNo), customerCode)
    const inline = req.query.inline === '1'
    const lower = file.fileName.toLowerCase()
    const mime = lower.endsWith('.pdf')
      ? 'application/pdf'
      : lower.endsWith('.png')
        ? 'image/png'
        : (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
          ? 'image/jpeg'
          : 'application/octet-stream'
    res.setHeader('Content-Type', mime)
    if (!inline) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    }
    res.send(file.content)
  } catch (e) {
    sendErpError(res, e)
  }
})

app.get('/api/erp/logistics/by-customer/:customerCode', async (req, res) => {
  try {
    res.json(await fetchErpLogisticsByCustomer(req.params.customerCode))
  } catch (e) {
    sendErpError(res, e)
  }
})

app.post('/api/accounts', requireSysAdmin, async (req, res) => {
  try {
    const body = req.body as {
      customerCode?: string
      customerName?: string
      companyName?: string
      contactEmail?: string
      contactName?: string
      contactPhone?: string
      omsType?: 'ecommerce' | 'catalog' | 'hybrid'
      warehouse?: string
      permissions?: string[]
      username?: string
      loginEmail?: string
      temporaryPassword?: string
    }
    const username = requestedUsername(body)
    const required: [string, unknown][] = [
      ['customerName', body.customerName],
      ['contactEmail', body.contactEmail],
      ['omsType', body.omsType],
      ['warehouse', body.warehouse],
      ['username', username],
      ['temporaryPassword', body.temporaryPassword],
    ]
    const missing = required.find(([, value]) => !String(value || '').trim())
    if (missing) return res.status(400).json({ error: `缺少 ${missing[0]}` })
    const customerCode = String(body.customerCode || '').trim()
    if (customerCode && (customerCode.length > 30 || !/^[A-Za-z0-9_-]+$/.test(customerCode))) {
      return res.status(400).json({ error: '客户代码最多 30 位，且只能包含字母、数字、下划线和短横线' })
    }
    if (String(body.customerName).trim().length > 200) {
      return res.status(400).json({ error: '客户名称最多 200 个字符' })
    }
    if (String(body.companyName || '').trim().length > 200) {
      return res.status(400).json({ error: '公司名称最多 200 个字符' })
    }
    if (String(body.contactName || '').trim().length > 50) {
      return res.status(400).json({ error: '联系人最多 50 个字符' })
    }
    if (String(body.contactPhone || '').trim().length > 30) {
      return res.status(400).json({ error: '联系电话最多 30 个字符' })
    }
    if (String(body.warehouse).trim().length > 100) {
      return res.status(400).json({ error: '仓库编码最多 100 个字符' })
    }
    if (!['ecommerce', 'catalog', 'hybrid'].includes(String(body.omsType))) {
      return res.status(400).json({ error: '客户类型无效' })
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: '登录账号须为 6-50 位字母、数字、点、下划线或短横线' })
    }
    const contactEmail = normalizeEmail(body.contactEmail)
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return res.status(400).json({ error: '联系邮箱格式无效' })
    }
    if (contactEmail.length > 120) {
      return res.status(400).json({ error: '联系邮箱最多 120 个字符' })
    }
    if (!isStrongPassword(String(body.temporaryPassword))) {
      return res.status(400).json({ error: '临时密码须为 6-128 位' })
    }
    if (!Array.isArray(body.permissions)) {
      return res.status(400).json({ error: 'permissions 必须是数组' })
    }
    const allowedCustomerPermissions = new Set<string>(
      SYS_ADMIN_PERMISSIONS.filter(permission => !permission.startsWith('account:')),
    )
    const permissions = [...new Set(body.permissions.map(String))]
    if (permissions.some(permission => !allowedCustomerPermissions.has(permission))) {
      return res.status(400).json({ error: 'permissions 包含无效或管理员专属权限' })
    }

    const provisioned = await provisionOmsCustomer({
      ...(customerCode ? { customerCode } : {}),
      customerName: String(body.customerName).trim(),
      companyName: String(body.companyName || '').trim() || undefined,
      contactEmail,
      contactName: String(body.contactName || '').trim() || undefined,
      contactPhone: String(body.contactPhone || '').trim() || undefined,
      omsType: body.omsType!,
      warehouse: String(body.warehouse).trim(),
      permissions,
      username,
      temporaryPassword: String(body.temporaryPassword),
    })
    res.status(201).json(provisioned)
  } catch (e) {
    sendErpError(res, e)
  }
})

app.patch('/api/accounts/:id', requireSysAdmin, async (req, res) => {
  try {
    const accountId = String(req.params.id)
    const existing = await prisma.customerAccount.findUnique({ where: { id: accountId } })
    if (!existing) return res.status(404).json({ error: '客户不存在' })

    const patch = req.body as Record<string, unknown>
    const erpPatch: Parameters<typeof updateOmsCustomer>[1] = {}
    const customerName = patch.customerName ?? patch.name
    const companyName = patch.companyName
    const contactName = patch.contactName ?? patch.contact
    const contactEmail = patch.contactEmail ?? patch.email
    const omsType = patch.omsType ?? patch.type

    if (customerName !== undefined) {
      const value = String(customerName).trim()
      if (!value || value.length > 200) {
        return res.status(400).json({ error: '客户名称须为 1-200 个字符' })
      }
      erpPatch.customerName = value
    }
    if (companyName !== undefined) {
      const value = String(companyName).trim()
      if (value.length > 200) return res.status(400).json({ error: '公司名称最多 200 个字符' })
      erpPatch.companyName = value
    }
    if (contactName !== undefined) {
      const value = String(contactName).trim()
      if (value.length > 50) return res.status(400).json({ error: '联系人最多 50 个字符' })
      erpPatch.contactName = value
    }
    if (contactEmail !== undefined) {
      const value = normalizeEmail(contactEmail)
      if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return res.status(400).json({ error: '联系邮箱格式无效' })
      }
      erpPatch.contactEmail = value
    }
    if (patch.contactPhone !== undefined) {
      const value = String(patch.contactPhone).trim()
      if (value.length > 30) return res.status(400).json({ error: '联系电话最多 30 个字符' })
      erpPatch.contactPhone = value
    }
    if (patch.status !== undefined) {
      if (patch.status === 'active' || patch.status === 1 || patch.status === true) {
        erpPatch.status = 1
      } else if (patch.status === 'disabled' || patch.status === 0 || patch.status === false) {
        erpPatch.status = 0
      } else {
        return res.status(400).json({ error: '账号状态无效' })
      }
    }
    if (omsType !== undefined) {
      const value = String(omsType)
      if (!['ecommerce', 'catalog', 'hybrid'].includes(value)) {
        return res.status(400).json({ error: '客户类型无效' })
      }
      erpPatch.omsType = value as 'ecommerce' | 'catalog' | 'hybrid'
    }
    if (patch.warehouse !== undefined) {
      const value = String(patch.warehouse).trim()
      if (!value || value.length > 100) return res.status(400).json({ error: '仓库编码无效' })
      erpPatch.warehouse = value
    }
    if (patch.permissions !== undefined) {
      if (!Array.isArray(patch.permissions)) {
        return res.status(400).json({ error: '权限列表格式无效' })
      }
      erpPatch.permissions = patch.permissions.map(String)
    }
    if (patch.permissionTemplate !== undefined) {
      erpPatch.permissionTemplate = String(patch.permissionTemplate).trim()
    }
    if (patch.username !== undefined || patch.loginEmail !== undefined) {
      const value = requestedUsername(patch)
      if (!isValidUsername(value)) {
        return res.status(400).json({ error: '登录账号须为 6-50 位字母、数字、点、下划线或短横线' })
      }
      erpPatch.username = value
    }

    if (Object.keys(erpPatch).length > 0) {
      await updateOmsCustomer(existing.code, erpPatch)
    }

    const localData: Record<string, unknown> = {}
    if (patch.priceTemplateId !== undefined) {
      localData.priceTemplateId = patch.priceTemplateId == null
        ? null
        : String(patch.priceTemplateId)
    }
    if (patch.priceTemplateByRegion !== undefined) {
      localData.priceTemplateByRegion = JSON.stringify(patch.priceTemplateByRegion)
    }
    if (Object.keys(localData).length > 0) {
      await prisma.customerAccount.update({ where: { id: accountId }, data: localData })
    }
    const updated = await prisma.customerAccount.findUniqueOrThrow({
      where: { id: accountId },
      include: {
        portalUser: {
          select: {
            username: true,
            status: true,
            mustChangePassword: true,
            lastLoginAt: true,
          },
        },
      },
    })
    res.json({
      ...updated,
      permissions: parseJson(updated.permissions, []),
      priceTemplateByRegion: updated.priceTemplateByRegion
        ? parseJson<Record<string, string | null>>(updated.priceTemplateByRegion, {})
        : undefined,
    })
  } catch (e) {
    sendErpError(res, e)
  }
})

app.put('/api/inventory-state', async (req, res) => {
  try {
    const { inventory, products, purchases } = req.body as {
      inventory: Record<string, unknown>[]
      products: Record<string, unknown>[]
      purchases: Record<string, unknown>[]
    }
    const scope = customerScope(req as AuthenticatedRequest)
    if (scope) {
      const [existingProducts, existingInventory, existingPurchases] = await Promise.all([
        prisma.product.findMany({
          where: { id: { in: products.map(item => String(item.id)) } },
          select: { customerId: true },
        }),
        prisma.inventoryItem.findMany({
          where: { id: { in: inventory.map(item => String(item.id)) } },
          select: { customerId: true },
        }),
        prisma.catalogPurchase.findMany({
          where: { id: { in: (purchases || []).map(item => String(item.id)) } },
          select: { customerId: true },
        }),
      ])
      if (
        [...existingProducts, ...existingInventory, ...existingPurchases]
          .some(item => item.customerId !== scope)
      ) return res.status(403).json({ error: 'Cross-customer mutation denied' })
    }

    const skuSeen = new Set<string>()
    for (const p of products) {
      const sku = String(p.internalSku || '').trim().toLowerCase()
      if (!sku) {
        return res.status(400).json({ error: '产品缺少 SKU' })
      }
      if (skuSeen.has(sku)) {
        return res.status(400).json({ error: `重复 SKU：${String(p.internalSku).trim()}` })
      }
      skuSeen.add(sku)
    }

    await prisma.$transaction(async tx => {
      for (const p of products) {
        const id = String(p.id)
        const data = {
          customerId: scope ?? (p.customerId as string | null | undefined) ?? null,
          internalSku: String(p.internalSku),
          customerSku: (p.customerSku as string | null | undefined) ?? null,
          name: String(p.name),
          spec: String(p.spec),
          image: String(p.image),
          price: Number(p.price),
          cost: Number(p.cost),
          availableQty: Number(p.availableQty),
          lockedQty: Number(p.lockedQty),
          customCode: (p.customCode as string | null | undefined) ?? null,
          category: String(p.category),
          categoryPath: String(p.categoryPath),
          weight: String(p.weight),
          weightKg: Number(p.weightKg),
          lengthCm: Number(p.lengthCm),
          widthCm: Number(p.widthCm),
          heightCm: Number(p.heightCm),
          inCatalog: Boolean(p.inCatalog),
          productStatus: String(p.productStatus),
          hasBattery: Boolean(p.hasBattery),
          certUploaded: Boolean(p.certUploaded),
          hasBoxSpec: Boolean(p.hasBoxSpec),
          outerBoxBarcode: (p.outerBoxBarcode as string | null | undefined) ?? null,
          declaredNameEn: String(p.declaredNameEn),
          declaredNameCn: String(p.declaredNameCn),
          declaredValue: Number(p.declaredValue),
          unit: String(p.unit),
        }
        await tx.product.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }

      for (const i of inventory) {
        const id = String(i.id)
        const data = {
          customerId: scope ?? (i.customerId as string | null | undefined) ?? null,
          sku: String(i.sku),
          name: String(i.name),
          image: String(i.image),
          available: Number(i.available),
          locked: Number(i.locked),
          inTransit: Number(i.inTransit),
          safetyStock: Number(i.safetyStock),
          spec: String(i.spec),
          customCode: (i.customCode as string | null | undefined) ?? null,
          ean: (i.ean as string | null | undefined) ?? null,
          warehouse: String(i.warehouse),
          pendingShelving: Number(i.pendingShelving),
          pendingOutbound: Number(i.pendingOutbound),
          defective: Number(i.defective),
          shipped: Number(i.shipped),
          warningQty: Number(i.warningQty),
          price: Number(i.price),
          declaredNameEn: (i.declaredNameEn as string | null | undefined) ?? null,
          categoryPath: (i.categoryPath as string | null | undefined) ?? null,
          stockSource: String(i.stockSource),
        }
        await tx.inventoryItem.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }

      for (const p of purchases ?? []) {
        const id = String(p.id)
        const data = {
          purchaseNo: String(p.purchaseNo),
          customerId: scope ?? String(p.customerId),
          sku: String(p.sku),
          productName: String(p.productName),
          qty: Number(p.qty),
          createdAt: String(p.createdAt),
        }
        await tx.catalogPurchase.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })

    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/outbound-orders', async (req, res) => {
  try {
    const orders = req.body as Record<string, unknown>[]
    const scope = customerScope(req as AuthenticatedRequest)
    if (scope) {
      const existing = await prisma.outboundOrder.findMany({
        where: { id: { in: orders.map(item => String(item.id)) } },
        select: { customerId: true },
      })
      if (existing.some(item => item.customerId !== scope)) {
        return res.status(403).json({ error: 'Cross-customer mutation denied' })
      }
    }
    await prisma.$transaction(async tx => {
      const existingRows = await tx.outboundOrder.findMany()
      const settlementByNo = new Map(
        existingRows.map(r => [
          r.outboundNo,
          {
            actualFeesTotal: r.actualFeesTotal,
            settlementDelta: r.settlementDelta,
            settlementStatus: r.settlementStatus,
            measuredVolumeM3: r.measuredVolumeM3,
            measuredWeightKg: r.measuredWeightKg,
            status: r.status,
            trackingNo: r.trackingNo,
            recipient: r.recipient,
            destRegion: r.destRegion,
            priceTemplateId: r.priceTemplateId,
            priceTemplateName: r.priceTemplateName,
            preDeductTotal: r.preDeductTotal,
            preDeductVolumeM3: r.preDeductVolumeM3,
            preDeductWeightKg: r.preDeductWeightKg,
            preDeductSnapshot: r.preDeductSnapshot,
            measureSnapshot: r.measureSnapshot,
            actualFeesSnapshot: r.actualFeesSnapshot,
          },
        ]),
      )
      for (const o of orders) {
        const outboundNo = String(o.outboundNo)
        const preserved = settlementByNo.get(outboundNo)
        const preDeductSnapshot =
          (o.preDeduct as Record<string, unknown> | null | undefined) ??
          (o.preDeductTotal != null
            ? {
                destRegion: o.destRegion,
                priceTemplateId: o.priceTemplateId,
                priceTemplateName: o.priceTemplateName,
                preDeductTotal: Number(o.preDeductTotal),
                totalVolumeM3: o.preDeductVolumeM3,
                totalWeightKg: o.preDeductWeightKg,
                lines: o.preDeductFees || [],
              }
            : null)
        const data = {
          customerId: scope ?? (o.customerId as string | null | undefined) ?? null,
          source: String(o.source),
          stockSource: String(o.stockSource),
          refNo: (o.refNo as string | null | undefined) ?? null,
          orderNo: (o.orderNo as string | null | undefined) ?? null,
          type: String(o.type),
          warehouse: String(o.warehouse),
          items: Number(o.items),
          totalQty: Number(o.totalQty),
          status:
            preserved && ['shipped', 'delivered', 'cancelled', 'exception'].includes(preserved.status)
              ? preserved.status
              : String(o.status),
          destination: String(o.destination),
          createdAt: String(o.createdAt),
          trackingNo: (o.trackingNo as string | null | undefined) ?? preserved?.trackingNo ?? null,
          shippingMethod: (o.shippingMethod as string | null | undefined) ?? null,
          preDeductFees: o.preDeductFees ? JSON.stringify(o.preDeductFees) : null,
          recipient: o.recipient ? JSON.stringify(o.recipient) : preserved?.recipient ?? null,
          destRegion: (o.destRegion as string | null | undefined) ?? preserved?.destRegion ?? null,
          priceTemplateId: (o.priceTemplateId as string | null | undefined) ?? preserved?.priceTemplateId ?? null,
          priceTemplateName: (o.priceTemplateName as string | null | undefined) ?? preserved?.priceTemplateName ?? null,
          preDeductTotal: o.preDeductTotal != null ? Number(o.preDeductTotal) : preserved?.preDeductTotal ?? null,
          preDeductVolumeM3: o.preDeductVolumeM3 != null ? Number(o.preDeductVolumeM3) : preserved?.preDeductVolumeM3 ?? null,
          preDeductWeightKg: o.preDeductWeightKg != null ? Number(o.preDeductWeightKg) : preserved?.preDeductWeightKg ?? null,
          preDeductSnapshot: preDeductSnapshot ? JSON.stringify(preDeductSnapshot) : preserved?.preDeductSnapshot ?? null,
          measureSnapshot: o.measure ? JSON.stringify(o.measure) : preserved?.measureSnapshot ?? null,
          actualFeesSnapshot: o.actualFees ? JSON.stringify(o.actualFees) : preserved?.actualFeesSnapshot ?? null,
          actualFeesTotal:
            o.actualFeesTotal != null
              ? Number(o.actualFeesTotal)
              : preserved?.actualFeesTotal ?? null,
          settlementDelta:
            o.settlementDelta != null
              ? Number(o.settlementDelta)
              : preserved?.settlementDelta ?? null,
          settlementStatus:
            (o.settlementStatus as string | null | undefined) ??
            preserved?.settlementStatus ??
            null,
          measuredVolumeM3:
            o.measuredVolumeM3 != null
              ? Number(o.measuredVolumeM3)
              : preserved?.measuredVolumeM3 ?? null,
          measuredWeightKg:
            o.measuredWeightKg != null
              ? Number(o.measuredWeightKg)
              : preserved?.measuredWeightKg ?? null,
          scheduledDeliveryDate: (o.scheduledDeliveryDate as string | null | undefined) ?? null,
          sellerStoreName: (o.sellerStoreName as string | null | undefined) ?? null,
          takealotDestWarehouse: (o.takealotDestWarehouse as string | null | undefined) ?? null,
          takealotSellerId: (o.takealotSellerId as string | null | undefined) ?? null,
          takealotBookingRef: (o.takealotBookingRef as string | null | undefined) ?? null,
          shipmentDueDate: (o.shipmentDueDate as string | null | undefined) ?? null,
          remark: (o.remark as string | null | undefined) ?? null,
          exceptionCode: (o.exceptionCode as string | null | undefined) ?? null,
          exceptionReason: (o.exceptionReason as string | null | undefined) ?? null,
          lineItems: o.lineItems ? JSON.stringify(o.lineItems) : null,
          attachments: o.attachments ? JSON.stringify(o.attachments) : null,
        }
        await tx.outboundOrder.upsert({
          where: { outboundNo },
          create: { id: String(o.id), outboundNo, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/outbound-orders/:outboundNo', async (req, res) => {
  try {
    const outboundNo = String(req.params.outboundNo || '').trim()
    if (!outboundNo) {
      res.status(400).json({ error: '缺少出库单号' })
      return
    }
    const scope = customerScope(req as AuthenticatedRequest)
    const result = await prisma.outboundOrder.deleteMany({
      where: { outboundNo, ...(scope ? { customerId: scope } : {}) },
    })
    if (scope && result.count === 0) return res.status(404).json({ error: '出库单不存在' })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.get('/api/reports/summary', async (req: AuthenticatedRequest, res) => {
  try {
    const scope = customerScope(req)
    const [outbounds, inventory, fees] = await Promise.all([
      prisma.outboundOrder.findMany({
        where: scope ? { customerId: scope } : undefined,
        select: { createdAt: true, totalQty: true, status: true, actualFeesTotal: true, preDeductTotal: true },
      }),
      prisma.inventoryItem.findMany({
        where: scope ? { customerId: scope } : undefined,
        select: { available: true, locked: true, shipped: true },
      }),
      prisma.feeRecord.findMany({
        where: scope ? { customerCode: req.auth?.customerCode || '' } : undefined,
        select: { type: true, amount: true },
      }),
    ])
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
      return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: `${date.getMonth() + 1}月` }
    })
    const trendMap = new Map(months.map(month => [month.key, { ...month, orders: 0, units: 0, amount: 0 }]))
    for (const order of outbounds) {
      const row = trendMap.get(String(order.createdAt || '').slice(0, 7))
      if (!row) continue
      row.orders += 1
      row.units += Number(order.totalQty) || 0
      row.amount += Number(order.actualFeesTotal ?? order.preDeductTotal) || 0
    }
    const feeLabels: Record<string, string> = {
      outbound: '出库费', storage: '仓储费', logistics: '物流费', operation: '操作费',
      recharge: '充值', refund: '退款', adjustment: '调整', other: '其他',
    }
    const feeMap = new Map<string, number>()
    for (const fee of fees) {
      const amount = Math.abs(Number(fee.amount) || 0)
      if (amount) feeMap.set(fee.type, (feeMap.get(fee.type) || 0) + amount)
    }
    const feeTotal = [...feeMap.values()].reduce((sum, amount) => sum + amount, 0)
    const activeOrders = outbounds.filter(order => order.status !== 'cancelled')
    const completedOrders = activeOrders.filter(order => ['shipped', 'delivered'].includes(order.status))
    const inventoryUnits = inventory.reduce((sum, item) => sum + item.available + item.locked, 0)
    const shippedUnits = inventory.reduce((sum, item) => sum + item.shipped, 0)
    res.json({
      inventoryTurnoverDays: shippedUnits > 0 ? Math.round(inventoryUnits / shippedUnits * 300) / 10 : null,
      fulfillmentRate: activeOrders.length ? Math.round(completedOrders.length / activeOrders.length * 1000) / 10 : 0,
      totals: {
        outboundOrders: outbounds.length,
        completedOrders: completedOrders.length,
        exceptionOrders: outbounds.filter(order => order.status === 'exception').length,
        inventoryUnits,
        fees: Math.round(feeTotal * 100) / 100,
      },
      orderTrend: months.map(month => trendMap.get(month.key)),
      feeBreakdown: [...feeMap.entries()].map(([type, amount]) => ({
        type, label: feeLabels[type] || type, amount: Math.round(amount * 100) / 100,
        pct: feeTotal ? Math.round(amount / feeTotal * 1000) / 10 : 0,
      })).sort((left, right) => right.amount - left.amount),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '真实报表数据加载失败' })
  }
})

app.get('/api/billing', async (req: AuthenticatedRequest, res) => {
  try {
    const scope = customerScope(req)
    const billing = scope
      ? await prisma.billingAccount.findUnique({ where: { customerId: scope } })
      : await prisma.billingAccount.findFirst({ orderBy: { id: 'asc' } })
    const feeRecords = await prisma.feeRecord.findMany({
      where: scope ? { customerCode: req.auth!.customerCode } : undefined,
      orderBy: { date: 'desc' },
    })
    let creditBalance = billing?.creditBalance ?? 0
    if (scope && req.auth?.customerCode) {
      try {
        const erp = await fetchErpCustomerByCode(req.auth.customerCode)
        const preDeduct = openPreDeductTotal(feeRecords)
        creditBalance = Math.round((Number(erp.balance) - preDeduct) * 100) / 100
      } catch {
        // ERP 不可用时回退本地镜像余额
      }
    }
    res.json({
      creditBalance,
      feeRecords,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/logistics', async (req, res) => {
  try {
    const records = req.body as Record<string, unknown>[]
    const scope = customerScope(req as AuthenticatedRequest)
    if (scope) {
      const requestedOutboundNos = new Set(records.map(item => String(item.outboundNo)))
      const existingLogistics = await prisma.logisticsRecord.findMany({
        where: { id: { in: records.map(item => String(item.id)) } },
        select: { outboundNo: true },
      })
      for (const item of existingLogistics) requestedOutboundNos.add(item.outboundNo)
      const owned = await prisma.outboundOrder.findMany({
        where: { customerId: scope, outboundNo: { in: [...requestedOutboundNos] } },
        select: { outboundNo: true },
      })
      const ownedNos = new Set(owned.map(item => item.outboundNo))
      if ([...requestedOutboundNos].some(outboundNo => !ownedNos.has(outboundNo))) {
        return res.status(403).json({ error: 'Cross-customer mutation denied' })
      }
    }
    await prisma.$transaction(async tx => {
      for (const r of records) {
        const id = String(r.id)
        const data = {
            refNo: String(r.refNo),
            outboundNo: String(r.outboundNo),
            carrier: String(r.carrier),
            trackingNo: String(r.trackingNo),
            status: String(r.status),
            destination: String(r.destination),
            updatedAt: String(r.updatedAt),
            podStatus: String(r.podStatus),
            podCode: (r.podCode as string | null | undefined) ?? null,
            podFileName: (r.podFileName as string | null | undefined) ?? null,
            podFileUrl: (r.podFileUrl as string | null | undefined) ?? null,
            podUploadedAt: (r.podUploadedAt as string | null | undefined) ?? null,
            exceptionCode: (r.exceptionCode as string | null | undefined) ?? null,
            exceptionReason: (r.exceptionReason as string | null | undefined) ?? null,
        }
        await tx.logisticsRecord.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/billing', async (req: AuthenticatedRequest, res) => {
  try {
  const { creditBalance, feeRecords } = req.body as {
      creditBalance: number
      feeRecords: Record<string, unknown>[]
    }
    const requestedBalance = Math.round(Number(creditBalance) * 100) / 100
    if (!Number.isFinite(requestedBalance)) {
      return res.status(400).json({ error: 'Invalid creditBalance' })
    }

    await prisma.$transaction(async tx => {
      const scope = customerScope(req)
      const billing = scope
        ? await tx.billingAccount.findUnique({ where: { customerId: scope } })
        : await tx.billingAccount.findFirst({ orderBy: { id: 'asc' } })
      if (!billing) throw new Error('Billing account not found')
      if (!scope) {
        await tx.billingAccount.update({
          where: { id: billing.id },
          data: { creditBalance: requestedBalance },
        })
      }
      for (const f of feeRecords || []) {
        const id = String(f.id)
        const data = {
          date: String(f.date),
          type: String(f.type),
          refNo: String(f.refNo),
          desc: String(f.desc),
          amount: Number(f.amount),
          method: (f.method as string | null | undefined) ?? null,
          customerCode: scope
            ? req.auth!.customerCode
            : (f.customerCode as string | null | undefined) ?? null,
          rechargeNo: (f.rechargeNo as string | null | undefined) ?? null,
          paymentMethodId: (f.paymentMethodId as string | null | undefined) ?? null,
          paymentMethodTitle: (f.paymentMethodTitle as string | null | undefined) ?? null,
        }
        await tx.feeRecord.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/billing/pre-deduct/:outboundNo', async (req: AuthenticatedRequest, res) => {
  try {
    const outboundNo = String(req.params.outboundNo || '').trim()
    if (!outboundNo) return res.status(400).json({ error: '缺少 outboundNo' })
    const scope = customerScope(req)
    if (scope) {
      try {
        await fetchErpOutboundByNo(outboundNo)
        return res.status(409).json({ error: '出库单已提交 ERP，不能自行退回预扣' })
      } catch (e) {
        if (!(e instanceof ErpApiError) || (e.status !== 404 && e.status !== 400)) {
          throw e
        }
      }
    }
    const result = await prisma.$transaction(async tx => {
      const records = await tx.feeRecord.findMany({
        where: {
          refNo: outboundNo,
          method: 'pre_deduct',
          ...(scope ? { customerCode: req.auth!.customerCode } : {}),
        },
      })
      const refunded = records.reduce((sum, record) => sum + Math.abs(record.amount), 0)
      const billing = scope
        ? await tx.billingAccount.findUnique({ where: { customerId: scope } })
        : await tx.billingAccount.findFirst({ orderBy: { id: 'asc' } })
      if (records.length > 0) {
        await tx.feeRecord.deleteMany({
          where: {
            refNo: outboundNo,
            method: 'pre_deduct',
            ...(scope ? { customerCode: req.auth!.customerCode } : {}),
          },
        })
      }
      const nextBalance = (billing?.creditBalance ?? 0) + refunded
      if (billing && !scope) {
        await tx.billingAccount.update({ where: { id: billing.id }, data: { creditBalance: nextBalance } })
      }
      return { refunded, creditBalance: nextBalance }
    })
    let creditBalance = result.creditBalance
    if (scope && req.auth?.customerCode) {
      try {
        const erp = await fetchErpCustomerByCode(req.auth.customerCode)
        const remaining = await prisma.feeRecord.findMany({
          where: { customerCode: req.auth.customerCode },
        })
        const preDeduct = openPreDeductTotal(remaining)
        creditBalance = Math.round((Number(erp.balance) - preDeduct) * 100) / 100
      } catch {
        creditBalance = Math.round((Number(result.creditBalance) - Number(result.refunded)) * 100) / 100
      }
    }
    res.json({ ok: true, refunded: result.refunded, creditBalance })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/fee-templates', async (req, res) => {
  try {
    const body = req.body as {
      priceTemplate?: Record<string, unknown>
      priceTemplates?: Record<string, unknown>[]
      storageTemplate: Record<string, unknown>
      regionDispatchRules: Record<string, unknown>[]
    }

    const priceTemplates = body.priceTemplates?.length
      ? body.priceTemplates
      : body.priceTemplate
        ? [body.priceTemplate]
        : []

    await prisma.$transaction(async tx => {
      for (const priceTemplate of priceTemplates) {
        const id = String(priceTemplate.id)
        const data = {
            name: String(priceTemplate.name),
            regionCode: String(priceTemplate.regionCode ?? 'jhb'),
            warehouseId: String(priceTemplate.warehouseId),
            status: String(priceTemplate.status),
            handling: JSON.stringify(priceTemplate.handling),
            shippingByRegion: JSON.stringify(priceTemplate.shippingByRegion),
            pickupByRegion: JSON.stringify(priceTemplate.pickupByRegion ?? {}),
            updatedAt: String(priceTemplate.updatedAt),
        }
        await tx.priceTemplate.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }

      const storageId = String(body.storageTemplate.id)
      const storageData = {
          name: String(body.storageTemplate.name),
          warehouseId: String(body.storageTemplate.warehouseId),
          status: String(body.storageTemplate.status),
          billingUnit: String(body.storageTemplate.billingUnit),
          pricePerCbmPerDay: Number(body.storageTemplate.pricePerCbmPerDay),
          pricePerPiecePerDay: Number(body.storageTemplate.pricePerPiecePerDay),
          minChargePerDay: Number(body.storageTemplate.minChargePerDay),
          freeStorageDays: Number(body.storageTemplate.freeStorageDays),
          updatedAt: String(body.storageTemplate.updatedAt),
      }
      await tx.storageRentTemplate.upsert({
        where: { id: storageId },
        create: { id: storageId, ...storageData },
        update: storageData,
      })

      for (const r of body.regionDispatchRules) {
        const id = String(r.id)
        const data = {
            code: String(r.code),
            label: String(r.label),
            shippingMethod: String(r.shippingMethod),
            enabled: Boolean(r.enabled),
            remark: (r.remark as string | null | undefined) ?? null,
        }
        await tx.regionDispatchRule.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })

    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/fee-templates/price/:id', async (req, res) => {
  try {
    await prisma.priceTemplate.deleteMany({ where: { id: String(req.params.id) } })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/fee-templates/region/:id', async (req, res) => {
  try {
    await prisma.regionDispatchRule.deleteMany({ where: { id: String(req.params.id) } })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/platform-sku-mappings', async (req, res) => {
  try {
    const list = req.body as Record<string, unknown>[]
    const scope = customerScope(req as AuthenticatedRequest)
    if (scope) {
      const existing = await prisma.platformSkuMapping.findMany({
        where: { id: { in: list.map(item => String(item.id)) } },
        select: { customerId: true },
      })
      if (existing.some(item => item.customerId !== scope)) {
        return res.status(403).json({ error: 'Cross-customer mutation denied' })
      }
    }
    await prisma.$transaction(async tx => {
      for (const m of list) {
        const id = String(m.id)
        const data = {
            customerId: scope ?? (m.customerId as string | null | undefined) ?? null,
            sellerId: (m.sellerId as string | null | undefined) ?? null,
            platform: String(m.platform),
            storeId: String(m.storeId),
            storeName: String(m.storeName),
            platformSkuId: (m.platformSkuId as string | null | undefined) || null,
            platformBarcode: String(m.platformBarcode),
            platformTitle: String(m.platformTitle),
            platformListingId: (m.platformListingId as string | null | undefined) ?? null,
            lines: JSON.stringify(m.lines ?? []),
            status: String(m.status),
            stockSource: String(m.stockSource),
            syncSource: String(m.syncSource),
            version: Number(m.version),
            hasInventory: Boolean(m.hasInventory),
            lastSyncAt: (m.lastSyncAt as string | null | undefined) ?? null,
            updatedAt: String(m.updatedAt),
        }
        await tx.platformSkuMapping.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/platform-sku-mappings/:id', async (req, res) => {
  try {
    const scope = customerScope(req as AuthenticatedRequest)
    const result = await prisma.platformSkuMapping.deleteMany({
      where: { id: String(req.params.id), ...(scope ? { customerId: scope } : {}) },
    })
    if (scope && result.count === 0) return res.status(404).json({ error: '绑定不存在' })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})


app.put('/api/inbound-orders', async (req, res) => {
  try {
    const list = req.body as Record<string, unknown>[]
    const scope = customerScope(req as AuthenticatedRequest)
    if (scope) {
      const existing = await prisma.inboundOrder.findMany({
        where: { id: { in: list.map(item => String(item.id)) } },
        select: { customerId: true },
      })
      if (existing.some(item => item.customerId !== scope)) {
        return res.status(403).json({ error: 'Cross-customer mutation denied' })
      }
    }
    await prisma.$transaction(async tx => {
      for (const o of list) {
        const id = String(o.id)
        const data = {
            customerId: scope ?? (o.customerId as string | null | undefined) ?? null,
            inboundNo: String(o.inboundNo),
            source: String(o.source),
            inboundType: String(o.inboundType),
            deliveryMethod: String(o.deliveryMethod),
            stockSource: String(o.stockSource),
            boxCount: Number(o.boxCount),
            skuCount: Number(o.skuCount),
            totalQty: Number(o.totalQty),
            receivedQty: Number(o.receivedQty ?? 0),
            status: String(o.status),
            createdAt: String(o.createdAt),
            eta: (o.eta as string | null | undefined) ?? null,
            warehouse: String(o.warehouse),
            referenceNo: (o.referenceNo as string | null | undefined) ?? null,
            trackingNo: (o.trackingNo as string | null | undefined) ?? null,
            contact: (o.contact as string | null | undefined) ?? null,
            contactPhone: (o.contactPhone as string | null | undefined) ?? null,
            skuHint: (o.skuHint as string | null | undefined) ?? null,
            remark: (o.remark as string | null | undefined) ?? null,
            exceptionCode: (o.exceptionCode as string | null | undefined) ?? null,
            exceptionReason: (o.exceptionReason as string | null | undefined) ?? null,
            lineItems: o.lineItems ? JSON.stringify(o.lineItems) : null,
            attachments: o.attachments ? JSON.stringify(o.attachments) : null,
        }
        await tx.inboundOrder.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/inbound-orders/:id', async (req, res) => {
  try {
    const scope = customerScope(req as AuthenticatedRequest)
    const result = await prisma.inboundOrder.deleteMany({
      where: { id: String(req.params.id), ...(scope ? { customerId: scope } : {}) },
    })
    if (scope && result.count === 0) return res.status(404).json({ error: '入库单不存在' })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/return-orders', async (req, res) => {
  try {
    const list = req.body as Record<string, unknown>[]
    const scope = customerScope(req as AuthenticatedRequest)
    if (scope) {
      const existing = await prisma.returnOrder.findMany({
        where: { id: { in: list.map(item => String(item.id)) } },
        select: { customerId: true },
      })
      if (existing.some(item => item.customerId !== scope)) {
        return res.status(403).json({ error: 'Cross-customer mutation denied' })
      }
    }
    await prisma.$transaction(async tx => {
      for (const o of list) {
        const id = String(o.id)
        const data = {
          customerId: scope ?? (o.customerId as string | null | undefined) ?? null,
          returnNo: String(o.returnNo),
          orderNo: String(o.orderNo),
          referenceNo: (o.referenceNo as string | null | undefined) ?? null,
          trackingNo: (o.trackingNo as string | null | undefined) ?? null,
          sellerStoreName: (o.sellerStoreName as string | null | undefined) ?? null,
          sellerTaxNo: (o.sellerTaxNo as string | null | undefined) ?? null,
          returnWarehouse: (o.returnWarehouse as string | null | undefined) ?? null,
          expectedArrivalAt: (o.expectedArrivalAt as string | null | undefined) ?? null,
          returnReason: String(o.returnReason),
          returnDescription: (o.returnDescription as string | null | undefined) ?? null,
          requestedProcess: String(o.requestedProcess),
          status: String(o.status),
          processResult: (o.processResult as string | null | undefined) ?? null,
          processRemark: (o.processRemark as string | null | undefined) ?? null,
          receivedAt: (o.receivedAt as string | null | undefined) ?? null,
          processedAt: (o.processedAt as string | null | undefined) ?? null,
          createdAt: String(o.createdAt),
          lineItems: o.lineItems ? JSON.stringify(o.lineItems) : null,
          remark: (o.remark as string | null | undefined) ?? null,
          attachments: o.attachments ? JSON.stringify(o.attachments) : null,
          estimatedFeeTotal: o.estimatedFeeTotal == null ? null : String(o.estimatedFeeTotal),
          totalVolumeCbm: o.totalVolumeCbm == null ? null : String(o.totalVolumeCbm),
          inspectionResult: (o.inspectionResult as string | null | undefined) ?? null,
          inspectionRemark: (o.inspectionRemark as string | null | undefined) ?? null,
          customerDecision: (o.customerDecision as string | null | undefined) ?? null,
          customerDecidedAt: (o.customerDecidedAt as string | null | undefined) ?? null,
          customerProcessChoice: (o.customerProcessChoice as string | null | undefined) ?? null,
        }
        await tx.returnOrder.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/return-orders/:id', async (req, res) => {
  try {
    const scope = customerScope(req as AuthenticatedRequest)
    const result = await prisma.returnOrder.deleteMany({
      where: { id: String(req.params.id), ...(scope ? { customerId: scope } : {}) },
    })
    if (scope && result.count === 0) return res.status(404).json({ error: '退件单不存在' })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/orders', async (req, res) => {
  try {
    const list = req.body as Record<string, unknown>[]
    const scope = customerScope(req as AuthenticatedRequest)
    if (scope) {
      const existing = await prisma.order.findMany({
        where: { id: { in: list.map(item => String(item.id)) } },
        select: { customerId: true },
      })
      if (existing.some(item => item.customerId !== scope)) {
        return res.status(403).json({ error: 'Cross-customer mutation denied' })
      }
    }
    await prisma.$transaction(async tx => {
      for (const o of list) {
        const id = String(o.id)
        const data = {
            orderNo: String(o.orderNo),
            customerId: scope ?? (o.customerId as string | null | undefined) ?? null,
            platform: String(o.platform),
            store: String(o.store),
            country: String(o.country),
            countryCode: String(o.countryCode),
            skuCount: Number(o.skuCount),
            warehouse: String(o.warehouse),
            logistics: String(o.logistics),
            status: String(o.status),
            exception: (o.exception as string | null | undefined) ?? null,
            exceptionReason: (o.exceptionReason as string | null | undefined) ?? null,
            amount: Number(o.amount),
            createdAt: String(o.createdAt),
            recipient: String(o.recipient),
            address: String(o.address),
            items: JSON.stringify(o.items ?? []),
            tracking: JSON.stringify(o.tracking ?? []),
            fees: JSON.stringify(o.fees ?? []),
            logs: JSON.stringify(o.logs ?? []),
        }
        await tx.order.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/payment-methods', async (req, res) => {
  try {
    const list = req.body as Record<string, unknown>[]
    await prisma.$transaction(async tx => {
      for (const m of list) {
        const id = String(m.id)
        const data = {
            type: String(m.type),
            title: String(m.title),
            enabled: Boolean(m.enabled ?? true),
            sortOrder: Number(m.sortOrder ?? 0),
            bankName: (m.bankName as string | null | undefined) ?? null,
            accountName: (m.accountName as string | null | undefined) ?? null,
            accountNumber: (m.accountNumber as string | null | undefined) ?? null,
            branch: (m.branch as string | null | undefined) ?? null,
            swiftCode: (m.swiftCode as string | null | undefined) ?? null,
            qrCodeUrl: (m.qrCodeUrl as string | null | undefined) ?? null,
            accountId: (m.accountId as string | null | undefined) ?? null,
            customText: String(m.customText ?? ''),
            updatedAt: String(m.updatedAt ?? new Date().toISOString().slice(0, 10)),
        }
        await tx.paymentMethod.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        })
      }
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

async function start() {
  if (
    process.env.NODE_ENV === 'production'
    && Buffer.byteLength(String(process.env.OMS_INTERNAL_TOKEN || '').trim(), 'utf8') < 32
  ) {
    throw new Error('OMS_INTERNAL_TOKEN must be configured with at least 32 bytes in production')
  }
  await ensureConfiguredPortalAdmin(prisma)
  const listenHost = String(process.env.LISTEN_HOST || '127.0.0.1').trim() || '127.0.0.1'
  app.listen(PORT, listenHost, () => {
    console.log(`OMS API listening on http://${listenHost}:${PORT}`)
  })
}

void start().catch(async error => {
  console.error('OMS API failed to start', error)
  await prisma.$disconnect()
  process.exit(1)
})
