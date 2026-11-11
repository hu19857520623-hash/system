import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'

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
  async deliver(tx: Prisma.TransactionClient, log: { id: bigint; referenceNo: string | null; requestBody: unknown; retryCount: number | null; status: string }) {
    if (log.status === 'success') return log
    const returnNo = log.referenceNo || ''
    await tx.$queryRaw`SELECT id FROM return_order WHERE return_no = ${returnNo} FOR UPDATE`
    const input = log.requestBody as { warehouseCode?: string } | null
    const sent = Boolean(this.sender && await this.sender(returnNo, input?.warehouseCode))
    const count = (log.retryCount || 0) + 1
    const message = sent ? '退件当前状态和库存已同步至 OMS' : '退件已保存，OMS 同步待重试；请勿重复收货、返库或收费'
    return tx.syncLog.update({ where: { id: log.id }, data: { status: sent ? 'success' : 'failed', retryCount: count,
      nextRetryAt: sent ? null : new Date(Date.now() + Math.min(300, 30 * count) * 1000),
      errorMessage: sent ? null : message, responseBody: { ok: sent, message } } })
  }
  async retry(id: bigint) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sync_log WHERE id = ${id} FOR UPDATE`
      const log = await tx.syncLog.findUnique({ where: { id } })
      if (!log || log.syncType !== 'return_status' || log.targetSystem !== 'OMS') return false
      return (await this.deliver(tx, log)).status === 'success'
    }, { isolationLevel: 'ReadCommitted', timeout: 40000 })
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
