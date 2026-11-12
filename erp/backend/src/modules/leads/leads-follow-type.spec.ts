import { LeadsService } from './leads.service'

describe('跟进方式', () => {
  function setup() {
    const prisma = {
      sysUser: { findMany: jest.fn(async () => []) },
      leadFollowUp: {
        create: jest.fn(async ({ data }) => ({ id: 1n, ...data })),
      },
      lead: { update: jest.fn() },
    }
    const service = new LeadsService(prisma as any, {} as any, {} as any, {} as any)
    jest.spyOn(service, 'detail').mockResolvedValue({ id: 10, followSales: '销售甲' } as any)
    return { service, prisma }
  }

  it.each(['phone', 'wechat', 'wecom', 'email', 'visit', 'other'])(
    '%s 原样保存并返回，企微与微信保持独立', async followType => {
      const { service, prisma } = setup()
      const result = await service.addFollowUp(10, {
        followType, content: '已联系客户', status: 'following',
      }, 2)
      expect(prisma.leadFollowUp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          leadId: 10n, operatorId: 2n, followType, content: '已联系客户',
        }),
      })
      expect(result.followType).toBe(followType)
    },
  )

  it('无效方式不能写入跟进记录或更新线索', async () => {
    const { service, prisma } = setup()
    await expect(service.addFollowUp(10, {
      followType: 'invalid', content: '已联系客户',
    }, 2)).rejects.toThrow('跟进方式无效')
    expect(prisma.leadFollowUp.create).not.toHaveBeenCalled()
    expect(prisma.lead.update).not.toHaveBeenCalled()
  })

  it('列表与详情按同一顺序读取跟进记录，并保留原始方式', async () => {
    const records = [
      { id: 12n, followType: 'wecom' },
      { id: 11n, followType: 'wechat' },
    ]
    const row = { id: 10n, followUps: records, corrections: [], deals: [] }
    const prisma = {
      lead: {
        findMany: jest.fn(async () => [{ ...row, followUps: records.slice(0, 1) }]),
        count: jest.fn(async () => 1),
        findUnique: jest.fn(async () => row),
      },
      sysUser: { findMany: jest.fn(async () => []) },
    }
    const service = new LeadsService(prisma as any, {} as any, {} as any, {} as any)
    const list = await service.list({})
    const detail = await service.detail(10)
    expect(prisma.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ followUps: { orderBy: { id: 'desc' }, take: 1 } }),
    }))
    expect(prisma.lead.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ followUps: { orderBy: { id: 'desc' } } }),
    }))
    expect(list.items[0].followUps[0].followType).toBe(detail.followUps[0].followType)
    expect(detail.followUps.map(item => item.followType)).toEqual(['wecom', 'wechat'])
  })
})
