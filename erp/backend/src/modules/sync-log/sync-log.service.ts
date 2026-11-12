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

  /**
   * A success status requires an actual acknowledgement from the current source.
   * 三段式：短事务锁定并校验 → 事务外执行 OMS 推送（外部 HTTP 自带超时重试，
   * 不能占用数据库事务和行锁）→ 短事务落同步结果。失败仍留待重试，不改业务数据。
   */
  async retry(id: number) {
    const plan = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sync_log WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.syncLog.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('同步日志不存在，请刷新列表核对')
      if (row.syncType === 'return_status' && row.targetSystem === 'OMS' && this.returnsSync) return { kind: 'return' as const, row }
      if (row.syncType !== 'announcement_push' || row.targetSystem !== 'OMS') {
        throw new BadRequestException('此类记录不能从同步日志直接重试，请返回对应业务单据使用原操作核对或恢复同步')
      }
      const match = /^ANN-([1-9]\d*)$/.exec(row.referenceNo || '')
      if (!match || !Number.isSafeInteger(Number(match[1]))) throw new BadRequestException('原公告编号无效，请返回公告管理核对')
      const announcement = await this.announcements.readReplayable(Number(match[1]), tx)
      return { kind: 'announcement' as const, row, announcement }
    }, { isolationLevel: 'ReadCommitted', timeout: 40000 })

    if (plan.kind === 'return') {
      const updated = await this.returnsSync!.deliver(plan.row)
      return { ...updated, message: updated.status === 'success' ? '退件当前状态和库存已同步至 OMS' : '退件已保存，OMS 同步待重试；请勿重复收货、返库或收费' }
    }

    const sent = await this.announcements.sendReplay(plan.announcement)
    const message = sent ? '当前公告已重新同步至 OMS' : 'OMS 尚未确认同步，请稍后重试；公告内容未被重复修改'
    return this.prisma.$transaction(async tx => {
      const fresh = await tx.syncLog.findUnique({ where: { id: BigInt(id) } })
      if (!fresh || fresh.status === 'success') return { ...fresh, message }
      const updated = await tx.syncLog.update({
        where: { id: fresh.id },
        data: { status: sent ? 'success' : 'failed', retryCount: (fresh.retryCount ?? 0) + 1,
          errorMessage: sent ? null : message, responseBody: { ok: sent, message } },
      })
      return { ...updated, message }
    }, { isolationLevel: 'ReadCommitted' })
  }
}
