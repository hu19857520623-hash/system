import { ReturnsSyncService } from './returns-sync.service'

describe('durable return notification recovery', () => {
  it('keeps failed work durable and a recreated worker sends current data without replaying business actions', async () => {
    const jobs: any[] = []
    const tx: any = { $queryRaw: jest.fn(), syncLog: {
      create: jest.fn(async ({ data }) => { const job = { id: 1n, retryCount: 0, ...data }; jobs.push(job); return job }),
      findUnique: jest.fn(async () => jobs[0]),
      findMany: jest.fn(async () => jobs.filter(job => job.status !== 'success')),
      update: jest.fn(async ({ data }) => Object.assign(jobs[0], data)),
    } }
    const prisma: any = { $transaction: (work: any) => work(tx), syncLog: tx.syncLog }
    const first = new ReturnsSyncService(prisma)
    first.setSender(jest.fn().mockResolvedValue(false))
    await first.enqueue(tx, 'RT-ONE', 'WMS-JHB-01')
    expect(await first.retry(1n)).toBe(false)
    expect(jobs[0].status).toBe('failed')
    expect(jobs[0].nextRetryAt.getTime()).toBeGreaterThan(Date.now())
    const sender = jest.fn().mockResolvedValue(true)
    const recreated = new ReturnsSyncService(prisma)
    recreated.setSender(sender)
    await recreated.drain()
    expect(jobs[0].status).toBe('success')
    expect(jobs[0].retryCount).toBe(2)
    expect(sender).toHaveBeenCalledWith('RT-ONE', 'WMS-JHB-01')
    await recreated.retry(1n)
    expect(sender).toHaveBeenCalledTimes(1)
  })
})
