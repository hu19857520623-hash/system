import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { LeadsService } from './leads.service'

function setup(existing: Record<string, unknown>) {
  const lead = {
    id: 1n,
    leadNo: 'LD-1',
    companyName: '甲公司',
    contactName: '13800138000',
    contactPhone: '13800138000',
    email: null,
    source: '抖音',
    status: 'new',
    assigneeId: 2n,
    createdById: 9n,
    followSales: null,
    remark: null,
    customerId: null,
    deals: [],
    ...existing,
  }
  const prisma = {
    sysUser: {
      findUnique: jest.fn().mockResolvedValue({ id: 9n, roleCode: 'cs', status: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    lead: {
      findUnique: jest.fn()
        .mockResolvedValueOnce(lead)
        .mockResolvedValue({ ...lead, followUps: [], deals: lead.deals, corrections: [] }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(async ({ data }) => data),
      create: jest.fn().mockImplementation(async ({ data }) => data),
    },
    leadCorrection: {
      create: jest.fn().mockResolvedValue({ id: 1n }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const service = new LeadsService(prisma as any, {} as any, {} as any, {} as any)
  return { service, prisma, lead }
}

describe('lead correction', () => {
  const payload = {
    companyName: '乙公司',
    contact: 'wxid_a',
    email: 'a@b.c',
    source: '视频号',
    remark: '改过',
  }

  it('lets the registrant correct an open lead and writes a change record', async () => {
    const { service, prisma } = setup({})
    await service.correct(1, payload, 9)
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: {
        companyName: '乙公司',
        contactType: 'wechat',
        contactName: 'wxid_a',
        contactPhone: null,
        qrImagePath: null,
        qrImageHash: null,
        email: 'a@b.c',
        source: '视频号',
        remark: '改过',
      },
    })
    expect(prisma.leadCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 1n,
        operatorId: 9n,
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'companyName', before: '甲公司', after: '乙公司' }),
          expect.objectContaining({ field: 'contact', before: '13800138000', after: 'wxid_a' }),
        ]),
      }),
    })
    const written = prisma.lead.update.mock.calls[0][0].data
    expect(written).not.toHaveProperty('status')
    expect(written).not.toHaveProperty('assigneeId')
    expect(written).not.toHaveProperty('followSales')
    expect(written).not.toHaveProperty('createdById')
  })

  it('rejects another user, a missing registrant, and a dealt lead', async () => {
    const other = setup({})
    await expect(other.service.correct(1, payload, 8)).rejects.toBeInstanceOf(ForbiddenException)

    const historical = setup({ createdById: null })
    await expect(historical.service.correct(1, payload, 9)).rejects.toBeInstanceOf(ForbiddenException)

    const dealt = setup({ status: 'deal' })
    await expect(dealt.service.correct(1, payload, 9)).rejects.toBeInstanceOf(BadRequestException)

    const hasDeal = setup({ status: 'following', deals: [{ id: 3n }] })
    await expect(hasDeal.service.correct(1, payload, 9)).rejects.toThrow('已成交线索不能更正资料')
  })

  it('rejects a duplicate contact and a save with no changes', async () => {
    const duplicate = setup({})
    duplicate.prisma.lead.findMany.mockResolvedValue([
      { contactName: 'wxid_a', contactPhone: null, leadNo: 'LD-2', companyName: '丙公司' },
    ])
    await expect(duplicate.service.correct(1, payload, 9)).rejects.toThrow('该联系方式已存在（LD-2 / 丙公司）')
    expect(duplicate.prisma.lead.update).not.toHaveBeenCalled()

    const same = setup({})
    await expect(same.service.correct(1, {
      companyName: '甲公司',
      contact: '13800138000',
      email: '',
      source: '抖音',
      remark: '',
    }, 9)).rejects.toThrow('没有需要保存的修改')
  })

  it('stores the logged-in user as the registrant', async () => {
    const { service, prisma } = setup({})
    await service.create({
      companyName: '甲公司',
      contactName: '13900139000',
      assigneeId: 2,
    }, 9)
    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ createdById: 9n }),
    })
  })

  it('does not let the generic update rewrite registration fields', async () => {
    const { service, prisma } = setup({})
    jest.spyOn(service, 'detail').mockResolvedValue({
      status: 'new', followSales: '', remark: null, contactName: '13800138000', contactPhone: '13800138000',
    } as any)
    await service.update(1, { companyName: '被篡改', contactName: 'wxid_b', source: '视频号', followSales: '刘海静' })
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { followSales: '刘海静', status: 'following' },
    })
  })
})
