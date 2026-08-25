import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PermissionsService } from '../../common/permissions/permissions.service'
import type { AuthUser } from '../../common/decorators/current-user.decorator'
import {
  decryptStoreApiKey,
  encryptStoreApiKey,
  isEncryptedStoreApiKey,
  maskStoreApiKey,
  resolveStoreApiKeySecret,
} from './store-api-key.crypto'
import {
  ALL_STORE_SLOTS,
  coachLabel,
  coachRoleForSlot,
} from './store-monitor.constants'

const VALID_COACH_ROLES = ['coach1', 'coach2'] as const
const MIN_API_KEY_LENGTH = 16

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function takealotAuthFailed(status: number, payload: Record<string, unknown>, raw = '') {
  const detail = String(
    payload.message || payload.detail || payload.description || payload.title || raw || '',
  ).trim()
  const lower = detail.toLowerCase()
  return (
    status === 401
    || lower.includes('authentication failed')
    || lower === 'unauthorized'
  )
}

function takealotErrorMessage(status: number, payload: Record<string, unknown>, raw = '') {
  if (takealotAuthFailed(status, payload, raw)) {
    return 'Takealot API Key 无效或已过期，请重新粘贴完整密钥后保存再测试'
  }
  const detail = String(
    payload.message || payload.detail || payload.description || payload.title || '',
  ).trim()
  return detail || `Takealot 接口返回 HTTP ${status}`
}

@Injectable()
export class StoreMonitorService {
  private proxyBase: string

  constructor(
    private prisma: PrismaService,
    private permissions: PermissionsService,
    private config: ConfigService,
  ) {
    this.proxyBase = (
      this.config.get<string>('TAKEALOT_PROXY_URL')
      || 'http://127.0.0.1:3456'
    ).replace(/\/+$/, '')
  }

  private secret() {
    return resolveStoreApiKeySecret(
      this.config.get<string>('STORE_API_KEY_SECRET'),
      this.config.get<string>('JWT_SECRET'),
    )
  }

  private plainApiKey(stored: string | null | undefined) {
    try {
      return decryptStoreApiKey(stored, this.secret())
    } catch {
      throw new BadRequestException('店铺 API Key 无法解密，请重新保存密钥')
    }
  }

  private persistApiKey(plain: string) {
    return encryptStoreApiKey(plain, this.secret())
  }

  private maskStoredKey(stored: string | null | undefined) {
    try {
      return maskStoreApiKey(decryptStoreApiKey(stored, this.secret()))
    } catch {
      return '****'
    }
  }

  private async resolvedApiKey(store: { slot: number; apiKey: string | null }) {
    const plain = this.plainApiKey(store.apiKey)
    if (!plain) throw new BadRequestException(`店铺 ${store.slot} 未配置 API Key`)
    if (store.apiKey && !isEncryptedStoreApiKey(store.apiKey)) {
      await this.prisma.takealotStore.update({
        where: { slot: store.slot },
        data: { apiKey: this.persistApiKey(plain) },
      })
    }
    return plain
  }

  private async fetchProxy(path: string, init?: RequestInit, timeoutMs = 90_000) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(`${this.proxyBase}${path}`, {
        ...init,
        signal: controller.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (controller.signal.aborted) {
        throw new ServiceUnavailableException('店铺监控代理响应超时，请检查本地代理服务')
      }
      throw new ServiceUnavailableException('店铺监控代理未启动（默认 127.0.0.1:3456）。请运行仓库根目录 dev-local.ps1，或单独执行 store-monitor 的 npm start')
    } finally {
      clearTimeout(timeout)
    }
  }

  private async userPerms(user: AuthUser) {
    return this.permissions.getUserPermissions(user.userId, user.roleCode)
  }

  private canViewAll(roleCode: string, perms: string[]) {
    return roleCode === 'admin' || perms.includes('store_monitor.view_all')
  }

  private canManageKeys(roleCode: string, perms: string[]) {
    return roleCode === 'admin' || perms.includes('store_monitor.manage')
  }

  private canAssignCoach(roleCode: string, perms: string[]) {
    return (
      roleCode === 'admin'
      || perms.includes('store_monitor.manage')
      || perms.includes('store_monitor.assign')
    )
  }

  /** 陪跑按数据库 coach_role 动态分配；主管/管理员看全部 */
  private async allowedSlots(roleCode: string, perms: string[]): Promise<number[]> {
    if (this.canViewAll(roleCode, perms)) return [...ALL_STORE_SLOTS]
    if (roleCode === 'coach1' || roleCode === 'coach2') {
      const stores = await this.prisma.takealotStore.findMany({
        where: { coachRole: roleCode },
        select: { slot: true },
        orderBy: { slot: 'asc' },
      })
      return stores.map((s) => s.slot)
    }
    if (perms.includes('store_monitor.view')) return [...ALL_STORE_SLOTS]
    return []
  }

  async ensureSeedStores() {
    const count = await this.prisma.takealotStore.count()
    if (count > 0) return
    const rows = ALL_STORE_SLOTS.map((slot) => ({
      slot,
      storeName: `店铺${slot}`,
      coachRole: coachRoleForSlot(slot)!,
      enabled: true,
    }))
    await this.prisma.takealotStore.createMany({ data: rows })
  }

  async session(user: AuthUser) {
    await this.ensureSeedStores()
    const perms = await this.userPerms(user)
    if (!perms.includes('store_monitor.view') && user.roleCode !== 'admin') {
      throw new ForbiddenException('无店铺监控权限')
    }
    const slots = await this.allowedSlots(user.roleCode, perms)
    const stores = await this.prisma.takealotStore.findMany({
      where: { slot: { in: slots } },
      orderBy: { slot: 'asc' },
    })
    const viewAll = this.canViewAll(user.roleCode, perms)
    return {
      viewAll,
      coachGroup: user.roleCode === 'coach1' ? '陪跑1' : user.roleCode === 'coach2' ? '陪跑2' : null,
      canManage: this.canManageKeys(user.roleCode, perms),
      canAssignCoach: this.canAssignCoach(user.roleCode, perms),
      sellers: stores.map((s) => ({
        id: `slot-${s.slot}`,
        slot: s.slot,
        name: s.storeName,
        coachRole: s.coachRole,
        coachLabel: coachLabel(s.coachRole),
        enabled: s.enabled && !!s.apiKey,
        configured: !!s.apiKey,
        sellerId: s.takealotSellerId ? Number(s.takealotSellerId) : null,
        displayName: s.displayName || s.storeName,
      })),
    }
  }

  async listStores(user: AuthUser) {
    await this.ensureSeedStores()
    const perms = await this.userPerms(user)
    const slots = await this.allowedSlots(user.roleCode, perms)
    const stores = await this.prisma.takealotStore.findMany({
      where: { slot: { in: slots } },
      orderBy: { slot: 'asc' },
    })
    const manageKeys = this.canManageKeys(user.roleCode, perms)
    const assignCoach = this.canAssignCoach(user.roleCode, perms)
    return stores.map((s) => ({
      id: Number(s.id),
      slot: s.slot,
      storeName: s.storeName,
      coachRole: s.coachRole,
      coachLabel: coachLabel(s.coachRole),
      enabled: s.enabled,
      configured: !!s.apiKey,
      takealotSellerId: s.takealotSellerId ? Number(s.takealotSellerId) : null,
      displayName: s.displayName,
      remark: s.remark,
      apiKeyMasked: manageKeys && s.apiKey
        ? this.maskStoredKey(s.apiKey)
        : '',
      canEditKey: manageKeys,
      canEditCoach: assignCoach,
    }))
  }

  async updateStore(
    user: AuthUser,
    slot: number,
    data: { storeName?: string; apiKey?: string; coachRole?: string; enabled?: boolean; remark?: string },
  ) {
    const perms = await this.userPerms(user)
    const manageKeys = this.canManageKeys(user.roleCode, perms)
    const assignCoach = this.canAssignCoach(user.roleCode, perms)

    if (data.apiKey !== undefined && !manageKeys) {
      throw new ForbiddenException('无 API Key 配置权限')
    }
    if ((data.enabled !== undefined || data.remark !== undefined) && !manageKeys) {
      throw new ForbiddenException('无店铺启停或备注编辑权限')
    }
    if (data.coachRole !== undefined && !assignCoach) {
      throw new ForbiddenException('无店铺陪跑分配权限')
    }
    if (
      data.storeName !== undefined
      && !manageKeys
      && !assignCoach
    ) {
      throw new ForbiddenException('无店铺编辑权限')
    }
    if (data.coachRole != null && !VALID_COACH_ROLES.includes(data.coachRole as typeof VALID_COACH_ROLES[number])) {
      throw new BadRequestException('陪跑角色只能是 coach1 或 coach2')
    }
    if (data.storeName !== undefined && !data.storeName.trim()) {
      throw new BadRequestException('店铺名称不能为空')
    }
    if (data.storeName && data.storeName.trim().length > 40) {
      throw new BadRequestException('店铺名称不能超过 40 个字符')
    }
    if (data.apiKey && data.apiKey.trim().length > 500) {
      throw new BadRequestException('API Key 长度异常')
    }
    if (data.apiKey && data.apiKey.trim().length < MIN_API_KEY_LENGTH) {
      throw new BadRequestException('API Key 过短，请粘贴 Takealot 后台生成的完整密钥，不要填写店铺名')
    }

    const row = await this.prisma.takealotStore.findUnique({ where: { slot } })
    if (!row) throw new NotFoundException('店铺不存在')

    const updated = await this.prisma.takealotStore.update({
      where: { slot },
      data: {
        storeName: data.storeName?.trim() ?? undefined,
        apiKey: data.apiKey === ''
          ? null
          : data.apiKey
            ? this.persistApiKey(data.apiKey.trim())
            : undefined,
        coachRole: data.coachRole ?? undefined,
        enabled: data.enabled ?? undefined,
        remark: data.remark ?? undefined,
      },
    })
    return {
      id: Number(updated.id),
      slot: updated.slot,
      storeName: updated.storeName,
      coachRole: updated.coachRole,
      coachLabel: coachLabel(updated.coachRole),
    }
  }

  async checkStore(user: AuthUser, slot: number) {
    const store = await this.assertSlotAccess(user, slot)
    const apiKey = await this.resolvedApiKey(store)
    const upstream = await this.fetchProxy('/api/proxy/seller', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
    })
    const text = await upstream.text()
    const payload = parseJsonObject(text)
    if (!upstream.ok) {
      throw new BadRequestException(takealotErrorMessage(upstream.status, payload, text))
    }

    const sellerIdValue = payload.seller_id
    const sellerId = (
      (typeof sellerIdValue === 'number' || typeof sellerIdValue === 'string')
      && /^\d+$/.test(String(sellerIdValue))
    ) ? String(sellerIdValue) : null
    const displayName = typeof payload.display_name === 'string' ? payload.display_name : null
    if (sellerId != null || displayName) {
      await this.prisma.takealotStore.update({
        where: { slot },
        data: {
          takealotSellerId: sellerId != null ? BigInt(sellerId) : undefined,
          displayName: displayName || undefined,
        },
      })
    }
    return {
      ok: true,
      status: upstream.status,
      via: upstream.headers.get('x-proxy-via') || 'unknown',
      sellerId: sellerId == null ? null : Number(sellerId),
      displayName,
    }
  }

  private async assertSlotAccess(user: AuthUser, slot: number) {
    const perms = await this.userPerms(user)
    const slots = await this.allowedSlots(user.roleCode, perms)
    if (!slots.includes(slot)) throw new ForbiddenException(`无权访问店铺 ${slot}`)
    const store = await this.prisma.takealotStore.findUnique({ where: { slot } })
    if (!store) throw new NotFoundException('店铺不存在')
    if (!store.enabled || !store.apiKey) throw new BadRequestException(`店铺 ${slot} 未配置 API Key`)
    return store
  }

  async proxyTakealot(user: AuthUser, slot: number, req: Request, res: Response) {
    const store = await this.assertSlotAccess(user, slot)
    const m = req.originalUrl.match(/\/store-monitor\/proxy\/(.+)$/)
    const subPath = m ? m[1] : ''
    const decodedPath = decodeURIComponent(subPath.split('?')[0] || '')
    if (
      !subPath
      || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')
      || decodedPath.includes('\\')
    ) {
      throw new BadRequestException('无效的 Takealot API 路径')
    }
    const apiKey = await this.resolvedApiKey(store)
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-API-Key': apiKey,
    }
    if (req.headers['content-type']) headers['Content-Type'] = String(req.headers['content-type'])

    const init: RequestInit = { method: req.method, headers }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    }

    const upstream = await this.fetchProxy(`/api/proxy/${subPath}`, init)
    const text = await upstream.text()
    const payload = parseJsonObject(text)
    if (takealotAuthFailed(upstream.status, payload, text)) {
      res.status(400)
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({
        message: takealotErrorMessage(upstream.status, payload, text),
      }))
      return
    }
    res.status(upstream.status)
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    const via = upstream.headers.get('x-proxy-via')
    if (via) res.setHeader('X-Proxy-Via', via)
    res.send(text)
  }

  async proxyDiag(user: AuthUser, res: Response) {
    const perms = await this.userPerms(user)
    if (!perms.includes('store_monitor.view') && user.roleCode !== 'admin') {
      throw new ForbiddenException('无权限')
    }
    const upstream = await this.fetchProxy('/api/diag')
    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.send(text)
  }

  async proxyBrowserBootstrap(user: AuthUser, res: Response) {
    const perms = await this.userPerms(user)
    if (user.roleCode !== 'admin' && !perms.includes('store_monitor.manage')) {
      throw new ForbiddenException('无权限')
    }
    const upstream = await this.fetchProxy('/api/browser-bootstrap', { method: 'POST' }, 260_000)
    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.send(text)
  }
}
