import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'

type SyncLogRow = { id: bigint; referenceNo: string | null; requestBody: unknown; retryCount: number | null; status: string }

@Injectable()
export class ReturnsSyncService implements OnModuleInit, OnModuleDestroy {
  private sender?: (returnNo: string, warehouseCode?: string) => Promise<boolean>
  private timer?: ReturnType<typeof setInterval>
  private running = false
  constructor(private prisma: PrismaService) {}
  setSender(sender: (returnNo: string, warehouseCode?: string) => Promise<boolean>) { this.sender = sender }
  enqueue(tx: Prisma.TransactionClient, returnNo: string, warehouseCode?: string) {
    return tx.syncLog.create({ data: { syncType: 'return_status', targetSystem: 'OMS', referenceNo: returnNo,
      status: 'pending', nextRetryAt: new Date(), requestBody: { returnNo, ...(warehouseCode ? { warehouseCode } : {}) } } })
  }

  /**
   * 退件状态推送（OMS 为外部 HTTP，自带超时与重试）。
   * 外部调用必须在数据库事务之外执行：此前在事务内持 return_order 行锁等待 HTTP，
   * OMS 慢或失败时会把收货/测量/算费等用户操作拖到事务过期，表现为 500 服务器内部错误。
   * 现在先推送（无锁），再用短事务落同步结果；失败仍写回待重试，语义不变。
   */
  async deliver(log: SyncLogRow): Promise<{ id: bigint; status: string; [k: string]: unknown }> {
    if (log.status === 'success') return log as never
    const returnNo = log.referenceNo || ''
    const input = log.requestBody as { warehouseCode?: string } | null
    const sent = Boolean(this.sender && await this.sender(returnNo, input?.warehouseCode))
    const count = (log.retryCount || 0) + 1
    const message = sent ? '退件当前状态和库存已同步至 OMS' : '退件已保存，OMS 同步待重试；请勿重复收货、返库或收费'
    return this.prisma.$transaction(async tx => {
      const fresh = await tx.syncLog.findUnique({ where: { id: log.id } })
      if (fresh?.status === 'success') return fresh as never
      return tx.syncLog.update({ where: { id: log.id }, data: { status: sent ? 'success' : 'failed', retryCount: count,
        nextRetryAt: sent ? null : new Date(Date.now() + Math.min(300, 30 * count) * 1000),
        errorMessage: sent ? null : message, responseBody: { ok: sent, message } } }) as never
    }, { isolationLevel: 'ReadCommitted' })
  }

  async retry(id: bigint) {
    const log = await this.prisma.syncLog.findUnique({ where: { id } })
    if (!log || log.syncType !== 'return_status' || log.targetSystem !== 'OMS') return false
    const updated = await this.deliver(log)
    return updated.status === 'success'
  }
  async flush(returnNo: string) {
    try {
      const logs = await this.prisma.syncLog.findMany({ where: { syncType: 'return_status', targetSystem: 'OMS', referenceNo: returnNo, status: { in: ['pending', 'failed'] } }, orderBy: { id: 'asc' }, take: 50 })
      const results: boolean[] = []
      for (const log of logs) results.push(await this.retry(log.id))
      const remaining = await this.prisma.syncLog.count({ where: { syncType: 'return_status', targetSystem: 'OMS', referenceNo: returnNo, status: { in: ['pending', 'failed'] } } })
      return results.every(Boolean) && remaining === 0
    } catch { return false }
  }
  async drain() {
    if (this.running || !this.sender) return
    this.running = true
    try {
      const logs = await this.prisma.syncLog.findMany({ where: { syncType: 'return_status', targetSystem: 'OMS', status: { in: ['pending', 'failed'] }, nextRetryAt: { lte: new Date() } }, orderBy: { id: 'asc' }, take: 20 })
      for (const log of logs) {
        try { await this.retry(log.id) }
        catch { /* Keep this task durable and continue other independent returns. */ }
      }
    } catch { /* Pending records remain durable for the next pass. */ }
    finally { this.running = false }
  }
  onModuleInit() { this.timer = setInterval(() => { void this.drain() }, 10000); this.timer.unref() }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }
}
