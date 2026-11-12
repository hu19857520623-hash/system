import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { LeadsService } from './leads.service'
import { followUpRevision, isCurrentLeadSales } from './leads-access.util'
import { LeadsRecordGuard } from './leads-record.guard'
import { LeadsController } from './leads.controller'
import { GUARDS_METADATA } from '@nestjs/common/constants'

const actor = { userId: 2, username: 'alice', realName: '小艾', roleCode: 'cs' }
const users = [
  { id: 2n, username: 'alice', realName: '小艾' },
  { id: 3n, username: 'bob', realName: '小博' },
]

function setup(overrides: Record<string, unknown> = {}, granted = ['leads_follow.edit']) {
  const lead = { id: 10n, assigneeId: 2n, createdById: 3n, status: 'following', followSales: '小博(bob)', ...overrides }
  const record = {
    id: 20n, leadId: 10n, operatorId: 3n, followType: 'wechat', content: '原始内容',
    nextPlan: null as string | null, nextFollowAt: null as Date | null, createdAt: new Date('2026-09-20T08:00:00Z'),
  }
  const prisma = {
    lead: {
      findUnique: jest.fn(async () => lead),
      findMany: jest.fn(async (args: any) => args.select ? [
        { id: 10n, followSales: '小艾(alice)' }, { id: 99n, followSales: 'álice' },
      ] : []),
      groupBy: jest.fn(async () => [{ followSales: '小艾(alice)' }, { followSales: 'malice' }, { followSales: '小博(bob)' }]),
      count: jest.fn(async () => 0),
    },
    sysUser: { findMany: jest.fn(async () => users) },
    leadFollowUp: {
      findFirst: jest.fn(async ({ where }) => where.leadId === record.leadId ? record : null),
      updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
    },
    operationLog: { create: jest.fn(async (_args: any) => ({})) },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation(async fn => fn(prisma))
  const permissions = { userHasAnyPerm: jest.fn(async (_id, _role, perms: string[]) => perms.some(p => granted.includes(p))) }
  const service = new LeadsService(prisma as any, {} as any, {} as any, permissions as any)
  const input = { followType: 'wecom', content: '已通过企微联系', nextPlan: '发送资料', nextFollowAt: null, expectedRevision: followUpRevision(record) }
  return { service, prisma, record, input, lead }
}

describe('线索记录级权限', () => {
  it('当前负责人可编辑他人填写的全部跟进记录，保留填写人和原时间并留审计日志', async () => {
    const { service, prisma, record, input } = setup()
    const result = await service.updateFollowUp(10, 20, { ...input, operatorId: 2, leadId: 999, createdAt: '伪造时间' }, actor)
    expect(result).toMatchObject({ followType: 'wecom', operatorId: 3n, createdAt: record.createdAt, leadId: 10n })
    expect(prisma.leadFollowUp.updateMany.mock.calls[0][0].data).toEqual({
      followType: 'wecom', content: input.content, nextPlan: input.nextPlan, nextFollowAt: null,
    })
    expect(prisma.operationLog.create.mock.calls[0][0].data).toMatchObject({
      operatorId: 2n, targetId: '20', detail: { leadId: '10', before: { followType: 'wechat' }, after: { followType: 'wecom' } },
    })
    expect(result.revision).not.toBe(input.expectedRevision)
  })

  it('当前跟进销售也可编辑，不要求是原填写人', async () => {
    const { service, input } = setup({ assigneeId: 99n, followSales: '小艾(alice)' })
    await expect(service.updateFollowUp(10, 20, input, actor)).resolves.toMatchObject({ followType: 'wecom' })
  })

  it('失去归属后，原填写人和登记人均不能编辑或转派以获得历史编辑权限', async () => {
    const { service, prisma, input } = setup({ assigneeId: 99n, createdById: 2n })
    await expect(service.assertRecordAccess(10, actor, 'read')).resolves.toBeDefined()
    for (const mode of ['history', 'write'] as const) {
      await expect(service.assertRecordAccess(10, actor, mode)).rejects.toBeInstanceOf(NotFoundException)
    }
    await expect(service.updateFollowUp(10, 20, input, actor)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.leadFollowUp.updateMany).not.toHaveBeenCalled()
    expect(prisma.operationLog.create).not.toHaveBeenCalled()
  })

  it('没有功能编辑权限，即使负责该线索也不能编辑历史记录', async () => {
    const { service, prisma, input } = setup({}, ['leads_follow.view'])
    await expect(service.updateFollowUp(10, 20, input, actor)).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('有全量查看和编辑权限的主管可更正；未登录拒绝访问', async () => {
    const { service, input } = setup({ assigneeId: 99n }, ['leads_pool.view_all', 'leads_follow.edit'])
    await expect(service.updateFollowUp(10, 20, input, actor)).resolves.toBeDefined()
    await expect(service.assertRecordAccess(10, undefined as any)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('公共池保留查看和认领入口，不能直接修改历史记录', async () => {
    const { service } = setup({ status: 'recall', assigneeId: 99n, createdById: 99n }, ['leads_pool.view', 'leads_follow.edit'])
    await expect(service.assertRecordAccess(10, actor, 'read')).resolves.toBeDefined()
    await expect(service.assertRecordAccess(10, actor, 'follow')).resolves.toBeDefined()
    await expect(service.assertRecordAccess(10, actor, 'history')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('伪造线索编号不能修改另一条线索的跟进记录', async () => {
    const { service, prisma, input } = setup()
    await expect(service.updateFollowUp(11, 20, input, actor)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.leadFollowUp.updateMany).not.toHaveBeenCalled()
  })

  it('旧版本和并发覆盖均被拒绝，不写审计成功记录', async () => {
    const { service, prisma, input } = setup()
    await expect(service.updateFollowUp(10, 20, { ...input, expectedRevision: '0'.repeat(64) }, actor)).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.leadFollowUp.updateMany).not.toHaveBeenCalled()
    prisma.leadFollowUp.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.updateFollowUp(10, 20, input, actor)).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.operationLog.create).not.toHaveBeenCalled()
  })

  it('数据库事务冲突返回可识别的版本冲突提示', async () => {
    const { service, prisma, input } = setup()
    prisma.$transaction.mockRejectedValue({ code: 'P2034' })
    await expect(service.updateFollowUp(10, 20, input, actor)).rejects.toBeInstanceOf(ConflictException)
  })

  it('详情只向当前负责人或有全量编辑权限者显示编辑入口', async () => {
    for (const [overrides, granted, expected] of [
      [{}, ['leads_follow.edit'], true],
      [{}, ['leads_follow.view'], false],
      [{ assigneeId: 99n, createdById: 2n }, ['leads_follow.edit'], false],
    ] as const) {
      const { service } = setup(overrides, [...granted])
      jest.spyOn(service, 'detail').mockResolvedValue({ id: 10n, followUps: [] } as any)
      expect((await service.detailForUser(10, actor)).canEditFollowUps).toBe(expected)
    }
  })

  it('筛选他人归属或指定ID不能覆盖列表的访问范围，姓名包含关系不会授权', async () => {
    const { service, prisma } = setup()
    await service.list({ assigneeId: 99, leadIds: '99', status: 'deal' }, actor)
    const args = prisma.lead.findMany.mock.calls.find(([args]) => args.include)?.[0]
    expect(args.where.assigneeId).toBe(99n)
    expect(args.where.AND).toContainEqual({ OR: [
      { assigneeId: 2n }, { createdById: 2n }, { id: { in: [10n] } },
    ] })
  })

  it('所有带线索编号的HTTP路由经过记录守卫，非法编号不能通过', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, LeadsController)).toContain(LeadsRecordGuard)
    const leads = { assertRecordAccess: jest.fn(async () => ({})) }
    const guard = new LeadsRecordGuard(leads as any)
    const context = (id: string, handler: Function, method = 'GET') => ({
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ params: { id }, user: actor, method }) }),
    }) as any
    for (const handler of [function detail() {}, function qrImage() {}, function downloadDealAttachment() {}]) {
      await guard.canActivate(context('10', handler))
      expect(leads.assertRecordAccess).toHaveBeenLastCalledWith(10, actor, 'read')
    }
    await guard.canActivate(context('10', function updateFollowUp() {}, 'PUT'))
    expect(leads.assertRecordAccess).toHaveBeenLastCalledWith(10, actor, 'history')
    await expect(guard.canActivate(context('bad', function detail() {}))).rejects.toThrow('线索编号无效')
  })
})

describe('历史销售姓名安全匹配', () => {
  it('支持完整账号、历史昵称和多人记录，拒绝子串和重名', () => {
    for (const text of ['alice', '小艾', '小艾(alice)', '小艾@微信', '小博(bob), 小艾(alice)', '小艾(旧昵称)']) {
      expect(isCurrentLeadSales(text, 2, users)).toBe(true)
    }
    for (const text of ['malice', '小艾艾', '小艾(bob)', '', null]) expect(isCurrentLeadSales(text, 2, users)).toBe(false)
    const duplicates = [...users, { id: 4n, username: 'alice2', realName: '小艾' }]
    expect(isCurrentLeadSales('小艾', 2, duplicates)).toBe(false)
    expect(isCurrentLeadSales('小艾(alice2)', 2, duplicates)).toBe(false)
    expect(isCurrentLeadSales('小艾(alice)', 2, duplicates)).toBe(true)
    const collision = [...users, { id: 4n, username: '小艾', realName: '其他人' }]
    expect(isCurrentLeadSales('小艾', 2, collision)).toBe(false)
    expect(isCurrentLeadSales('小艾', 4, collision)).toBe(false)
  })
})
