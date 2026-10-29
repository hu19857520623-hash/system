import { AnnouncementService } from './announcement.service'

function fixture() {
  let row: any = { id: 9n, title: '原公告', content: '原正文', category: '系统', targetChannel: 'erp', isPinned: false,
    status: 'scheduled', publishedAt: null, scheduledAt: new Date('2077-02-01'), expiresAt: new Date('2077-03-01'), createdAt: new Date(0), updatedAt: new Date('2026-10-01') }
  const announcement = {
    findUnique: jest.fn(async () => ({ ...row })),
    findUniqueOrThrow: jest.fn(async () => ({ ...row })),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.updatedAt.getTime() !== row.updatedAt.getTime()) return { count: 0 }
      row = { ...row, ...data }; return { count: 1 }
    }),
  }
  const prisma = { announcement, $transaction: jest.fn(async fn => fn({ announcement })) }
  const cache = { invalidate: jest.fn() }
  return { service: new AnnouncementService(prisma as any, cache as any), announcement, cache, row: () => row }
}
describe('公告编辑版本和发布时间', () => {
  it('旧页面和缺失版本不能覆盖新正文，也不清缓存或提交写入', async () => {
    const f = fixture(), first = f.row().updatedAt.toISOString()
    await f.service.update(9, { title: '新公告', content: '新正文', expectedUpdatedAt: first })
    await expect(f.service.update(9, { title: '旧覆盖', expectedUpdatedAt: first })).rejects.toThrow('旧页面不能覆盖')
    await expect(f.service.update(9, { title: '无版本覆盖' })).rejects.toThrow('旧页面不能覆盖')
    expect(f.row().content).toBe('新正文'); expect(f.announcement.updateMany).toHaveBeenCalledTimes(1)
    expect(f.cache.invalidate).toHaveBeenCalledTimes(1)
  })
  it('原定时公告可明确切换立即发布并清空结束时间', async () => {
    const f = fixture()
    const result = await f.service.update(9, { title: '立即发布', content: '正文', publishMode: 'immediate', scheduledAt: null, expiresAt: null, expectedUpdatedAt: f.row().updatedAt.toISOString() })
    expect(result.status).toBe('published'); expect(result.publishedAt).toBeInstanceOf(Date)
    expect(result.expiresAt).toBeNull(); expect(result.scheduledAt!.getFullYear()).not.toBe(2077)
  })
  it('定时发布清除旧发布时间且保留明确的未来时间', async () => {
    const f = fixture(); f.row().publishedAt = new Date('2025-01-01'); f.row().status = 'published'
    const result = await f.service.update(9, { publishMode: 'scheduled', scheduledAt: '2078-02-01', expiresAt: null, expectedUpdatedAt: f.row().updatedAt.toISOString() })
    expect(result.status).toBe('scheduled'); expect(result.publishedAt).toBeNull(); expect(result.expiresAt).toBeNull()
  })
  it('读取后被其他请求抢先修改时原子拒绝，不返回假成功', async () => {
    const f = fixture(); f.announcement.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(f.service.update(9, { content: '竞争写入', expectedUpdatedAt: f.row().updatedAt.toISOString() })).rejects.toThrow('旧页面不能覆盖')
    expect(f.announcement.findUniqueOrThrow).not.toHaveBeenCalled(); expect(f.cache.invalidate).not.toHaveBeenCalled()
  })
  it('即使同毫秒保存也生成更高版本；非法计划时间不写入', async () => {
    const f = fixture(); const initial = f.row().updatedAt.getTime()
    await f.service.update(9, { content: '修改', expectedUpdatedAt: new Date(initial).toISOString() })
    expect(f.row().updatedAt.getTime()).toBeGreaterThan(initial)
    await expect(f.service.update(9, { publishMode: 'scheduled', scheduledAt: null, expectedUpdatedAt: f.row().updatedAt.toISOString() })).rejects.toThrow('请选择计划发布时间')
    expect(f.announcement.updateMany).toHaveBeenCalledTimes(1)
  })
})
