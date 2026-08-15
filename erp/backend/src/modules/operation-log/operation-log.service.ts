import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { operationActionLabel, operationModuleLabel } from './operation-log.constants'

export interface OperationLogInput {
  operatorId?: number
  operatorName?: string
  module: string
  action: string
  targetType?: string
  targetId?: string | number
  detail?: Record<string, unknown>
  ipAddress?: string
}

@Injectable()
export class OperationLogService {
  constructor(private prisma: PrismaService) {}

  async log(params: OperationLogInput) {
    let operatorName = params.operatorName?.trim()
    if (!operatorName && params.operatorId) {
      const user = await this.prisma.sysUser.findUnique({
        where: { id: BigInt(params.operatorId) },
        select: { realName: true, username: true },
      })
      operatorName = user?.realName || user?.username || undefined
    }

    return this.prisma.operationLog.create({
      data: {
        operatorId: params.operatorId ? BigInt(params.operatorId) : undefined,
        operatorName,
        module: params.module,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId != null ? String(params.targetId) : undefined,
        detail: params.detail ? (params.detail as Prisma.InputJsonValue) : undefined,
        ipAddress: params.ipAddress,
      },
    })
  }

  async list(q: PaginationDto & {
    module?: string
    action?: string
    operatorId?: number
    targetType?: string
    targetId?: string
    dateFrom?: string
    dateTo?: string
  }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.module) where.module = q.module
    if (q.action) where.action = q.action
    if (q.operatorId) where.operatorId = BigInt(q.operatorId)
    if (q.targetType) where.targetType = q.targetType
    if (q.targetId) where.targetId = q.targetId
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {}
      if (q.dateFrom) where.createdAt.gte = new Date(`${q.dateFrom}T00:00:00`)
      if (q.dateTo) where.createdAt.lte = new Date(`${q.dateTo}T23:59:59`)
    }
    if (q.keyword) {
      where.OR = [
        { targetId: { contains: q.keyword } },
        { operatorName: { contains: q.keyword } },
        { module: { contains: q.keyword } },
        { action: { contains: q.keyword } },
      ]
    }

    const [rows, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.operationLog.count({ where }),
    ])

    const items = rows.map((row) => ({
      id: Number(row.id),
      operatorId: row.operatorId ? Number(row.operatorId) : null,
      operatorName: row.operatorName || '—',
      module: row.module,
      moduleLabel: operationModuleLabel(row.module),
      action: row.action,
      actionLabel: operationActionLabel(row.action),
      targetType: row.targetType,
      targetId: row.targetId,
      detail: row.detail,
      createdAt: row.createdAt,
    }))

    return { items, total, page, pageSize }
  }
}
