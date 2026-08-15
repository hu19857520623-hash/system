import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { notifyOms } from '../../common/oms-notify.util'

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
  constructor(private prisma: PrismaService) {}

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
      data.status === 'scheduled' ||
      Boolean(scheduledAt && scheduledAt.getTime() > now.getTime())

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

    const publishedAt = scheduledAt && scheduledAt.getTime() <= now.getTime() ? scheduledAt : now
    if (expiresAt && expiresAt.getTime() <= publishedAt.getTime()) {
      throw new BadRequestException('结束时间必须晚于发布时间')
    }

    return {
      status: 'published' as const,
      scheduledAt: scheduledAt || publishedAt,
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

    for (const row of dueRows) {
      const publishedAt = row.scheduledAt || now
      const updated = await this.prisma.announcement.update({
        where: { id: row.id },
        data: {
          status: 'published',
          publishedAt,
        },
      })
      if (updated.targetChannel === 'oms') {
        await this.pushToOms(updated).catch(() => undefined)
      }
    }

    return dueRows.length
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
    await this.activateDueAnnouncements()
    const now = new Date()
    const rows = await this.prisma.announcement.findMany({
      where: {
        targetChannel: 'oms',
        ...this.visibleWhere(now),
      },
      orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    })
    return { items: rows.map((r) => this.toPublic(r)), total: rows.length }
  }

  /** ERP 工作台展示：已发布且未过期的 ERP 渠道公告 */
  async listVisibleForErp(take = 10) {
    await this.activateDueAnnouncements()
    const now = new Date()
    const rows = await this.prisma.announcement.findMany({
      where: {
        targetChannel: 'erp',
        ...this.visibleWhere(now),
      },
      orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      take,
    })
    return rows.map((row) => this.toPublic(row))
  }

  async create(data: any, publishedBy?: number) {
    const targetChannel = this.normalizeTarget(data.targetChannel)
    const plan = this.resolvePublishPlan(data)
    const row = await this.prisma.announcement.create({
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

    if (plan.status === 'published' && targetChannel === 'oms') {
      await this.pushToOms(row)
    }

    return {
      ...this.toPublic(row),
      omsSynced: targetChannel === 'oms' && plan.status === 'published',
      scheduled: plan.status === 'scheduled',
    }
  }

  async update(id: number, data: any) {
    const existing = await this.detail(id)
    const payload: any = { ...data }
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

    const updated = await this.prisma.announcement.update({
      where: { id: BigInt(id) },
      data: {
        ...payload,
        status: nextStatus,
        publishedAt: nextPublishedAt,
        scheduledAt: nextScheduledAt,
        expiresAt: nextExpiresAt,
      },
    })

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
    return { id }
  }

  /** 真实推送 OMS webhook，并写同步日志（失败不影响发布） */
  private async pushToOms(row: AnnouncementRow) {
    const payload = this.toPublic(row)
    await notifyOms('announcement.publish', null, payload as unknown as Record<string, unknown>)
    await this.prisma.syncLog
      .create({
        data: {
          syncType: 'announcement_push',
          targetSystem: 'OMS',
          referenceNo: `ANN-${row.id}`,
          status: 'success',
          requestBody: payload as object,
          responseBody: { ok: true, message: '公告已推送至 OMS webhook' },
        },
      })
      .catch(() => undefined)
  }
}
