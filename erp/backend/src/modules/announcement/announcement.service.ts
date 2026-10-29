import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { notifyOms } from '../../common/oms-notify.util'
import { CacheService } from '../../common/cache/cache.service'
import { createHash } from 'node:crypto'

type AnnouncementRow = {
  id: bigint
  title: string
  category: string
  content: string
  targetChannel: string
  isPinned: boolean | null
  publishedAt: Date | null
  scheduledAt: Date | null
  expiresAt: Date | null
  status: string
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class AnnouncementService {
  constructor(private prisma: PrismaService, private cache: CacheService) {}

  private normalizeTarget(raw?: string): 'erp' | 'oms' {
    return raw === 'oms' ? 'oms' : 'erp'
  }

  private parseDate(raw: unknown, label: string): Date | undefined {
    if (raw == null || raw === '') return undefined
    const date = new Date(String(raw))
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label}格式无效`)
    return date
  }

  private resolvePublishPlan(data: {
    status?: string
    scheduledAt?: unknown
    expiresAt?: unknown
    publishMode?: string
  }) {
    const now = new Date()
    const scheduledAt = this.parseDate(data.scheduledAt, '计划发布时间')
    const expiresAt = this.parseDate(data.expiresAt, '结束时间')
    const wantsDraft = data.status === 'draft'
    const wantsSchedule =
      data.publishMode === 'scheduled' ||
      (data.publishMode !== 'immediate' && (data.status === 'scheduled' ||
      Boolean(scheduledAt && scheduledAt.getTime() > now.getTime())))

    if (expiresAt && scheduledAt && expiresAt.getTime() <= scheduledAt.getTime()) {
      throw new BadRequestException('结束时间必须晚于计划发布时间')
    }

    if (wantsDraft) {
      return { status: 'draft' as const, scheduledAt, expiresAt, publishedAt: undefined as Date | undefined }
    }

    if (wantsSchedule) {
      if (!scheduledAt) throw new BadRequestException('请选择计划发布时间')
      if (scheduledAt.getTime() > now.getTime()) {
        return { status: 'scheduled' as const, scheduledAt, expiresAt, publishedAt: undefined as Date | undefined }
      }
    }

    const publishedAt = data.publishMode !== 'immediate' && scheduledAt && scheduledAt.getTime() <= now.getTime() ? scheduledAt : now
    if (expiresAt && expiresAt.getTime() <= publishedAt.getTime()) {
      throw new BadRequestException('结束时间必须晚于发布时间')
    }

    return {
      status: 'published' as const,
      scheduledAt: data.publishMode === 'immediate' ? publishedAt : scheduledAt || publishedAt,
      expiresAt,
      publishedAt,
    }
  }

  /** 当前可见公告的 Prisma 过滤条件 */
  visibleWhere(now = new Date()): Prisma.AnnouncementWhereInput {
    return {
      status: 'published',
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    }
  }

  /** 将到期的定时公告自动发布，并推送 OMS */
  async activateDueAnnouncements(now = new Date()) {
    const dueRows = await this.prisma.announcement.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    })

    let activated = 0
    for (const selected of dueRows) {
      const result = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM announcement WHERE id=${selected.id} FOR UPDATE`
        const current = await tx.announcement.findUnique({ where: { id: selected.id } })
        if (!current || current.status !== 'scheduled' || !current.scheduledAt || current.scheduledAt > now
          || current.updatedAt.getTime() !== selected.updatedAt.getTime()) return null
        const expired = !!current.expiresAt && current.expiresAt <= now
        const status = expired ? 'expired' : 'published'
        const changed = await tx.announcement.updateMany({
          where: { id: current.id, status: 'scheduled', updatedAt: current.updatedAt, scheduledAt: { lte: now } },
          data: { status, publishedAt: expired ? null : current.scheduledAt,
            updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) },
        })
        if (changed.count !== 1) return null
        if (!expired && current.targetChannel === 'oms') {
          const updated = await tx.announcement.findUniqueOrThrow({ where: { id: current.id } })
          await this.pushToOms(updated).catch(() => undefined)
        }
        return status
      }, { maxWait: 10000, timeout: 60000 })
      if (result) await this.cache.invalidate('announcements')
      if (result === 'published') activated++
    }

    return activated
  }

  private toPublic(row: AnnouncementRow) {
    return {
      id: Number(row.id),
      title: row.title,
      category: row.category,
      content: row.content,
      targetChannel: row.targetChannel,
      isPinned: !!row.isPinned,
      publishedAt: row.publishedAt,
      scheduledAt: row.scheduledAt,
      expiresAt: row.expiresAt,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      date: (row.publishedAt || row.scheduledAt || row.createdAt).toISOString().slice(0, 10),
      type: row.category || '系统',
    }
  }

  async list(q: PaginationDto & { status?: string; targetChannel?: string }) {
    await this.activateDueAnnouncements()
    const { page, pageSize } = getPagination(q)
    const where: Prisma.AnnouncementWhereInput = {}
    if (q.status) where.status = q.status
    if (q.targetChannel) where.targetChannel = this.normalizeTarget(q.targetChannel)
    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ isPinned: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.announcement.count({ where }),
    ])
    return {
      items: items.map((row) => this.toPublic(row)),
      total,
      page,
      pageSize,
    }
  }

  async detail(id: number) {
    const row = await this.prisma.announcement.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('公告不存在')
    return this.toPublic(row)
  }

  /** OMS P2：拉取已发布 OMS 渠道公告 */
  async listForOms() {
    const items = await this.cachedVisible('oms', 100)
    return { items, total: items.length }
  }

  /** ERP 工作台展示：已发布且未过期的 ERP 渠道公告 */
  async listVisibleForErp(take = 10) {
    return this.cachedVisible('erp', take)
  }

  private async cachedVisible(targetChannel: 'erp' | 'oms', take: number) {
    // Scheduled publication must still run when the visible list is cached.
    await this.activateDueAnnouncements()
    const items = await this.cache.remember('announcements', `erp:announcements:${targetChannel}:${take}`, 30, async () => {
      const rows = await this.prisma.announcement.findMany({
        where: { targetChannel, ...this.visibleWhere() },
        orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
        take,
      })
      return JSON.parse(JSON.stringify(rows.map(row => this.toPublic(row)))) as ReturnType<AnnouncementService['toPublic']>[]
    })
    const now = Date.now()
    return items.filter(row => !row.expiresAt || new Date(row.expiresAt).getTime() > now)
  }

  private requestId(value: unknown) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('原公告发布请求编号无效，请返回工作台核对')
    return value.toLowerCase()
  }

  private async lockPublisher(tx: Prisma.TransactionClient, userId: number) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new BadRequestException('无法确认原发布账号，请重新登录')
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM sys_user WHERE id=${BigInt(userId)} FOR UPDATE`
    if (!rows.length) throw new BadRequestException('原发布账号不存在，请重新登录')
  }

  private findCreateRequest(db: Pick<Prisma.TransactionClient, 'operationLog'>, id: string, userId: number) {
    return db.operationLog.findFirst({ where: { module: 'announcement_publish', operatorId: BigInt(userId), detail: { path: '$.clientRequestId', equals: id } } })
  }

  async createRequest(value: string, userId: number) {
    const requestId = this.requestId(value), row = await this.findCreateRequest(this.prisma, requestId, userId)
    return row ? { requestId, ...(row.detail as any).result } : { requestId, status: 'unknown' }
  }

  async cancelCreateRequest(value: string, userId: number) {
    const requestId = this.requestId(value)
    return this.prisma.$transaction(async tx => {
      await this.lockPublisher(tx, userId)
      const previous = await this.findCreateRequest(tx, requestId, userId)
      if (previous) return { requestId, ...(previous.detail as any).result }
      const result = { status: 'cancelled' }
      await tx.operationLog.create({ data: { module: 'announcement_publish', action: 'create', operatorId: BigInt(userId), detail: { clientRequestId: requestId, fingerprint: '', result } } })
      return { requestId, ...result }
    })
  }

  async create(data: any, publishedBy?: number) {
    const requestId = this.requestId(data.clientRequestId), userId = publishedBy || 0
    // Store only publication inputs: arbitrary extra fields cannot change the original request.
    const input = { title: data.title, content: data.content, category: data.category || '系统', targetChannel: this.normalizeTarget(data.targetChannel), isPinned: !!data.isPinned, status: data.status || 'published', publishMode: data.publishMode || null, scheduledAt: data.scheduledAt || null, expiresAt: data.expiresAt || null }
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const saved = await this.prisma.$transaction(async tx => {
      await this.lockPublisher(tx, userId)
      const previous = await this.findCreateRequest(tx, requestId, userId)
      if (previous) {
        const detail = previous.detail as any
        if (detail.result.status !== 'cancelled' && detail.fingerprint !== fingerprint) throw new ConflictException('原公告发布内容不能更改，请先核对或取消原请求')
        return { result: detail.result, created: false }
      }
      const row = await this.createRow(tx, input, userId)
      const result = { status: 'confirmed', announcementId: Number(row.id), scheduled: row.status === 'scheduled', scheduledAt: row.scheduledAt?.toISOString() || null, syncPending: row.targetChannel === 'oms' && row.status === 'published' }
      await tx.operationLog.create({ data: { module: 'announcement_publish', action: 'create', operatorId: BigInt(userId), targetType: 'announcement', targetId: String(row.id), detail: { clientRequestId: requestId, fingerprint, result } } })
      return { result, created: true }
    })
    if (saved.result.status === 'confirmed') {
      await this.cache.invalidate('announcements')
      if (saved.result.syncPending) {
        saved.result = await this.prisma.$transaction(async tx => {
          await this.lockPublisher(tx, userId)
          const receipt = await this.findCreateRequest(tx, requestId, userId)
          const detail = receipt!.detail as any, result = detail.result
          if (!result.syncPending) return result
          await tx.$queryRaw`SELECT id FROM announcement WHERE id=${BigInt(result.announcementId)} FOR UPDATE`
          const row = await tx.announcement.findUnique({ where: { id: BigInt(result.announcementId) } })
          // Retry current contents only. Removed, rescheduled or expired announcements are never republished.
          const shouldSend = row?.targetChannel === 'oms' && row.status === 'published' && (!row.expiresAt || row.expiresAt.getTime() > Date.now())
          const sent = shouldSend ? await this.pushToOms(row!) : false
          const next = { ...result, syncPending: shouldSend && !sent, omsSynced: sent, deliverySkipped: !shouldSend }
          await tx.operationLog.update({ where: { id: receipt!.id }, data: { detail: { ...detail, result: next } } })
          return next
        }, { maxWait: 10000, timeout: 60000 })
      }
    }
    return { requestId, ...saved.result }
  }

  private async createRow(tx: Prisma.TransactionClient, data: any, publishedBy: number) {
    const targetChannel = this.normalizeTarget(data.targetChannel)
    const plan = this.resolvePublishPlan(data)
    return tx.announcement.create({
      data: {
        title: data.title,
        category: data.category || '系统',
        content: data.content,
        targetChannel,
        isPinned: !!data.isPinned,
        status: plan.status,
        publishedBy: publishedBy ? BigInt(publishedBy) : undefined,
        publishedAt: plan.publishedAt,
        scheduledAt: plan.scheduledAt,
        expiresAt: plan.expiresAt,
      },
    })
  }

  async update(id: number, data: any) {
    const existing = await this.detail(id)
    const expected = this.parseDate(data.expectedUpdatedAt, '原公告版本')
    if (!expected || expected.getTime() !== existing.updatedAt.getTime()) {
      throw new ConflictException('公告内容或发布状态已变化，旧页面不能覆盖；请重新加载最新公告后核对')
    }
    const payload: any = { ...data }
    delete payload.expectedUpdatedAt
    delete payload.clientRequestId
    if (payload.targetChannel != null) {
      payload.targetChannel = this.normalizeTarget(payload.targetChannel)
    }
    if (payload.content != null && payload.text != null) {
      payload.content = payload.content || payload.text
      delete payload.text
    }

    const hasScheduleInput =
      payload.status != null ||
      payload.publishMode != null ||
      payload.scheduledAt != null ||
      payload.expiresAt != null

    let nextStatus = existing.status
    let nextPublishedAt = existing.publishedAt ? new Date(existing.publishedAt) : undefined
    let nextScheduledAt = existing.scheduledAt ? new Date(existing.scheduledAt) : undefined
    let nextExpiresAt =
      payload.expiresAt === null
        ? null
        : payload.expiresAt != null
          ? this.parseDate(payload.expiresAt, '结束时间')
          : existing.expiresAt
            ? new Date(existing.expiresAt)
            : undefined

    if (hasScheduleInput) {
      const plan = this.resolvePublishPlan({
        status: payload.status ?? existing.status,
        publishMode: payload.publishMode,
        scheduledAt:
          payload.scheduledAt !== undefined
            ? payload.scheduledAt
            : payload.publishMode === 'scheduled'
              ? existing.scheduledAt
              : null,
        expiresAt: payload.expiresAt !== undefined ? payload.expiresAt : existing.expiresAt,
      })
      nextStatus = plan.status
      nextPublishedAt = plan.publishedAt
      nextScheduledAt = plan.scheduledAt
      nextExpiresAt = plan.expiresAt ?? null
    }

    delete payload.publishMode
    delete payload.scheduledAt
    delete payload.expiresAt
    delete payload.status

    const updated = await this.prisma.$transaction(async tx => {
      const changed = await tx.announcement.updateMany({
      where: { id: BigInt(id), updatedAt: expected },
      data: {
        ...payload,
        status: nextStatus,
        publishedAt: nextPublishedAt ?? null,
        scheduledAt: nextScheduledAt ?? null,
        expiresAt: nextExpiresAt,
        updatedAt: new Date(Math.max(Date.now(), expected.getTime() + 1)),
      },
      })
      if (changed.count !== 1) throw new ConflictException('公告内容或发布状态已变化，旧页面不能覆盖；请重新加载最新公告后核对')
      return tx.announcement.findUniqueOrThrow({ where: { id: BigInt(id) } })
    })
    await this.cache.invalidate('announcements')

    const channel = payload.targetChannel || existing.targetChannel
    const shouldPushOms =
      channel === 'oms' &&
      (data.repushOms || (nextStatus === 'published' && existing.status !== 'published'))
    if (shouldPushOms) {
      await this.pushToOms(updated)
    }

    return this.toPublic(updated)
  }

  async remove(id: number) {
    await this.detail(id)
    await this.prisma.announcement.delete({ where: { id: BigInt(id) } })
    await this.cache.invalidate('announcements')
    return { id }
  }

  /** 真实推送 OMS webhook，并写同步日志（失败不影响发布） */
  private async pushToOms(row: AnnouncementRow) {
    const payload = this.toPublic(row)
    const sent = await notifyOms('announcement.publish', null, payload as unknown as Record<string, unknown>)
    await this.prisma.syncLog
      .create({
        data: {
          syncType: 'announcement_push',
          targetSystem: 'OMS',
          referenceNo: `ANN-${row.id}`,
          status: sent ? 'success' : 'failed',
          requestBody: payload as object,
          responseBody: { ok: sent, message: sent ? '公告已推送至 OMS webhook' : '公告已保存，OMS推送尚未完成，请核对同步日志后重试原发布' },
        },
      })
      .catch(() => undefined)
    return sent
  }
}
