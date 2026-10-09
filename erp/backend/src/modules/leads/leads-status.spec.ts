import { LeadsService } from './leads.service'

describe('lead status when assigning follow sales', () => {
  function setup() {
    const prisma = {
      sysUser: {
        findUnique: jest.fn().mockResolvedValue({ id: 1n, roleCode: 'cs', status: 1 }),
        findMany: jest.fn().mockResolvedValue([{ realName: '刘海静', username: 'liuhaijing' }]),
      },
      lead: {
        create: jest.fn().mockImplementation(async ({ data }) => data),
        update: jest.fn().mockImplementation(async ({ data }) => data),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const service = new LeadsService(prisma as any, {} as any, {} as any, {} as any)
    return { service, prisma }
  }

  it.each([
    ['刘海静', undefined, 'following'],
    ['   ', undefined, 'new'],
    ['刘海静', 'new', 'following'],
    ['刘海静', 'deal', 'deal'],
    ['刘海静', 'recall', 'recall'],
  ])('creates with salesperson %s and status %s as %s', async (followSales, status, expected) => {
    const { service } = setup()
    const lead = await service.create({
      companyName: '测试客户', contactName: '18128337767', assigneeId: 1, followSales, status,
    })
    expect(lead.status).toBe(expected)
  })

  it('recognizes a salesperson stored in an import remark', async () => {
    const { service } = setup()
    const lead = await service.create({
      companyName: '测试客户', contactName: '18128337767', assigneeId: 1,
      remark: '对接:刘海静',
    })
    expect(lead.status).toBe('following')
    expect(lead.followSales).toBe('刘海静(liuhaijing)')
  })

  it.each(['new', 'deal', 'recall', 'lost', 'hot', 'nurture'])('assigns sales while preserving %s when appropriate', async (status) => {
    const { service, prisma } = setup()
    jest.spyOn(service, 'detail').mockResolvedValue({ status, followSales: '', remark: null } as any)
    await service.update(1, { followSales: '刘海静' })
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { followSales: '刘海静', status: status === 'new' ? 'following' : status },
    })
  })
})
