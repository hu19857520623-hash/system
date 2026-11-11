import { SyncLogService } from './sync-log.service'
import { AnnouncementService } from '../announcement/announcement.service'
import { notifyOms } from '../../common/oms-notify.util'
jest.mock('../../common/oms-notify.util', () => ({ notifyOms: jest.fn() }))

describe('actual sync retry acknowledgement', () => {
  beforeEach(() => jest.clearAllMocks())
  function fixture() {
    const date = new Date('2026-01-01')
    const current: any = { id: 33n, title: '当前公告', category: '系统', content: '当前内容', targetChannel: 'oms', status: 'published', publishedAt: date, scheduledAt: date, expiresAt: null, createdAt: date, updatedAt: date }
    let log: any = { id: 134n, syncType: 'announcement_push', targetSystem: 'OMS', referenceNo: 'ANN-33', status: 'failed', retryCount: 0, requestBody: { title: '过时公告' } }
    const tx: any = { $queryRaw: jest.fn(), announcement: { findUnique: jest.fn(async () => current) }, syncLog: {
      findUnique: jest.fn(async () => log), update: jest.fn(async ({ data }) => (log = { ...log, ...data })),
    } }
    const service = new SyncLogService({ $transaction: (work: any) => work(tx) } as any, new AnnouncementService(null as any, null as any))
    return { service, tx, current, log }
  }
  it('keeps failed transport failed and only marks success after acknowledgement of current content', async () => {
    const f = fixture()
    jest.mocked(notifyOms).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect((await f.service.retry(134)).status).toBe('failed')
    const success = await f.service.retry(134)
    expect(success.status).toBe('success')
    expect(success.retryCount).toBe(2)
    expect(notifyOms).toHaveBeenLastCalledWith('announcement.publish', null, expect.objectContaining({ title: '当前公告' }))
  })
  it('rejects unsupported business types without pretending to redo the business operation', async () => {
    const f = fixture(); f.log.syncType = 'oms_catalog_purchase'
    await expect(f.service.retry(134)).rejects.toThrow('不能从同步日志直接重试')
    expect(f.tx.syncLog.update).not.toHaveBeenCalled(); expect(notifyOms).not.toHaveBeenCalled()
  })
  it.each(['draft', 'scheduled'])('does not replay a previously published version after current state becomes %s', async status => {
    const f = fixture(); f.current.status = status
    await expect(f.service.retry(134)).rejects.toThrow('原公告当前不可发布')
    expect(notifyOms).not.toHaveBeenCalled(); expect(f.tx.syncLog.update).not.toHaveBeenCalled()
  })
})
