import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { AnnouncementService } from '../announcement/announcement.service'
import { ReturnsSyncService } from '../returns/returns-sync.service'

@Injectable()
export class SyncLogService {
  constructor(private prisma: PrismaService, private announcements: AnnouncementService, private returnsSync?: ReturnsSyncService) {}

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

  /** A success status requires an actual acknowledgement from the current source. */
  async retry(id: number) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sync_log WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.syncLog.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('同步日志不存在，请刷新列表核对')
      if (row.syncType === 'return_status' && row.targetSystem === 'OMS' && this.returnsSync) return this.returnsSync.deliver(tx, row)
      if (row.syncType !== 'announcement_push' || row.targetSystem !== 'OMS') {
        throw new BadRequestException('此类记录不能从同步日志直接重试，请返回对应业务单据使用原操作核对或恢复同步')
      }
      const match = /^ANN-([1-9]\d*)$/.exec(row.referenceNo || '')
      if (!match || !Number.isSafeInteger(Number(match[1]))) throw new BadRequestException('原公告编号无效，请返回公告管理核对')
      const sent = await this.announcements.replayCurrentOms(Number(match[1]), tx)
      const message = sent ? '当前公告已重新同步至 OMS' : 'OMS 尚未确认同步，请稍后重试；公告内容未被重复修改'
      const updated = await tx.syncLog.update({
        where: { id: row.id },
        data: { status: sent ? 'success' : 'failed', retryCount: (row.retryCount ?? 0) + 1,
          errorMessage: sent ? null : message, responseBody: { ok: sent, message } },
      })
      return { ...updated, message }
    }, { isolationLevel: 'ReadCommitted', timeout: 40000 })
  }
}
