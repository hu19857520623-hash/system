import { LeadsService } from './leads.service'
import { leadsExportCsv, LEADS_EXPORT_LIMIT } from './leads-export.util'

describe('Filtered lead export', () => {
  const row = { id: 1n, leadNo: 'L001', companyName: '客户', source: 'Takealot',
    status: 'new', contactPhone: '00123', assigneeId: 9n, customerId: null, followUps: [] }
  function setup(rows = [row]) {
    const prisma = {
      lead: { findMany: jest.fn(async () => rows), count: jest.fn(async () => rows.length) },
      sysUser: { findMany: jest.fn(async () => [{ id: 9n, username: 'owner', realName: '运营' }]) },
    }
    const permissions = { userHasAnyPerm: jest.fn(async () => false) }
    return { prisma, service: new LeadsService(prisma as any, {} as any, {} as any, permissions as any) }
  }

  it('uses exactly the same filters as the list while ignoring pagination', async () => {
    const { prisma, service } = setup()
    const user = { userId: 9, roleCode: 'admin' } as any
    const q = { keyword: '客户', source: 'Takealot', status: 'new', assigneeId: 9,
      followSales: '__empty__', createdAtFrom: '2026-10-01', createdAtTo: '2026-10-08', page: 3, pageSize: 20 }
    await service.list(q, user)
    const listArgs = (prisma.lead.findMany.mock.calls as any)[0][0]
    const result = await service.exportCsv(q, user)
    const exportArgs = (prisma.lead.findMany.mock.calls as any)[1][0]
    expect(exportArgs.where).toEqual(listArgs.where)
    expect(exportArgs.skip).toBe(0)
    expect(exportArgs.take).toBe(LEADS_EXPORT_LIMIT + 1)
    expect(result.content.toString()).toContain('运营')
    expect(result.content.toString()).toContain('L001')
  })

  it('does not allow a client assignee to override the current user in mine mode', async () => {
    const { prisma, service } = setup()
    await service.exportCsv({ mine: '1', assigneeId: 777 }, { userId: 9, roleCode: 'viewer' } as any)
    expect((prisma.lead.findMany.mock.calls as any)[0][0].where.assigneeId).toBe(9n)
  })

  it('preserves the server follow-sales scope', async () => {
    const { prisma, service } = setup()
    const scope = { followSales: { in: ['owner'] } }
    ;(service as any).followSalesScope = jest.fn(async () => scope)
    await service.exportCsv({ followMine: '1', followSales: 'another-user' }, { userId: 9, roleCode: 'viewer' } as any)
    const where = (prisma.lead.findMany.mock.calls as any)[0][0].where
    expect(where.AND).toContainEqual(scope)
    expect(where.followSales).toBeUndefined()
  })

  it('limits selected export to requested IDs while retaining filters', async () => {
    const { prisma, service } = setup()
    await service.exportCsv({ leadIds: '1,2,1', status: 'new', source: 'Takealot' }, { userId: 9, roleCode: 'admin' } as any)
    const where = (prisma.lead.findMany.mock.calls as any)[0][0].where
    expect(where.id).toEqual({ in: [1n, 2n] })
    expect(where.status).toBe('new')
    expect(where.source).toBe('Takealot')
  })

  it('rejects invalid selected IDs instead of exporting every match', async () => {
    const { prisma, service } = setup()
    await expect(service.exportCsv({ leadIds: '1,,2' }, { userId: 9, roleCode: 'admin' } as any)).rejects.toThrow('所选线索')
    expect(prisma.lead.findMany).not.toHaveBeenCalled()
  })

  it('reports empty results and refuses to silently truncate large exports', async () => {
    await expect(setup([]).service.exportCsv({}, { userId: 9, roleCode: 'admin' } as any)).rejects.toThrow('没有可导出')
    const { service } = setup(Array.from({ length: LEADS_EXPORT_LIMIT + 1 }, () => row))
    await expect(service.exportCsv({}, { userId: 9, roleCode: 'admin' } as any)).rejects.toThrow('缩小筛选范围')
  })

  it('quotes CSV text, protects formulas, preserves phone text and formats dates', () => {
    const csv = leadsExportCsv([{ companyName: '=1+1', contactName: '姓名,"微信"\n换行',
      contactPhone: '00123', status: 'new', createdAt: new Date('2026-10-08T00:00:00Z'),
      remark: ' @SUM(1,2)', followUps: [{ content: '+cmd', nextPlan: '正常计划' }] }])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain("'=1+1")
    expect(csv).toContain('"姓名,""微信""\n换行"')
    expect(csv).toContain("'00123")
    expect(csv).toContain('2026-10-08 08:00:00')
    expect(csv).toContain("'+cmd")
    expect(csv).toContain("' @SUM")
  })
})
