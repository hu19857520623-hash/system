import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'

@Injectable()
export class SyncLogService {
  constructor(private prisma: PrismaService) {}

  async list(q: PaginationDto & { status?: string; syncType?: string; includeLegacy?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.syncType) {
      where.syncType = q.syncType
    } else if (q.includeLegacy !== 'true') {
      where.NOT = {
        OR: [
          { syncType: 'inbound_push' },
          { AND: [{ targetSystem: 'WMS' }, { syncType: { contains: 'inbound' } }] },
        ],
      }
    }
    if (q.keyword) where.referenceNo = { contains: q.keyword }
    const [items, total] = await Promise.all([
      this.prisma.syncLog.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.syncLog.count({ where }),
    ])
    return { items, total, page, pageSize }
  }

  /** ?????????????????? */
  async retry(id: number) {
    const row = await this.prisma.syncLog.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('???????')
    return this.prisma.syncLog.update({
      where: { id: BigInt(id) },
      data: { status: 'success', retryCount: (row.retryCount ?? 0) + 1, errorMessage: null },
    })
  }
}
