import { FlowDebugService } from './flow-debug.service'

describe('read-only flow trace', () => {
  function fixture() {
    const prisma = { $queryRawUnsafe: jest.fn().mockImplementation(async (sql: string, ...args: string[]) => {
      if (sql.includes('FROM `inbound_order`') && args.includes('RV-TEST')) return [{ id: 9n, inboundNo: 'RV-TEST', omsCustomerCode: 'TKL005', status: 'pending_putaway' }]
      if (sql.includes('FROM `oms_inboundorder`') && args.includes('RV-TEST')) return [{ id: 'oms-test', inboundNo: 'RV-TEST', status: 'partial', customerId: 'c1' }]
      return []
    }) }
    return { prisma, service: new FlowDebugService(prisma as any) }
  }
  it('requires a customer for SKU queries', async () => {
    const { service, prisma } = fixture()
    await expect(service.trace({ sku: '713105' })).rejects.toThrow('客户代码')
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })
  it('separates ERP and OMS values and never invokes writes', async () => {
    const { service, prisma } = fixture()
    const result = await service.trace({ orderNo: 'RV-TEST' })
    expect(result.sections.find(s => s.table === 'inbound_order')?.rows[0].id).toBe('9')
    expect(result.sections.find(s => s.table === 'oms_inboundorder')?.rows[0].status).toBe('partial')
    for (const call of prisma.$queryRawUnsafe.mock.calls) expect(call[0]).toMatch(/^SELECT /)
  })
  it('binds malicious search input as a parameter instead of SQL text', async () => {
    const { service, prisma } = fixture()
    const value = "x' OR 1=1 --"
    await service.trace({ orderNo: value })
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled()
    for (const [sql, ...args] of prisma.$queryRawUnsafe.mock.calls) { expect(sql).not.toContain(value); expect(args).toContain(value) }
  })
  it('reports a missing table and truncation rather than silently claiming complete data', async () => {
    const { service, prisma } = fixture()
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM `oms_inboundorder`')) throw new Error("Table doesn't exist")
      if (sql.includes('FROM `inbound_order`')) return Array.from({ length: 21 }, (_, i) => ({ id: i, inboundNo: 'RV-TEST' }))
      return []
    })
    const result = await service.trace({ orderNo: 'RV-TEST' })
    expect(result.sections.find(s => s.table === 'oms_inboundorder')?.state).toBe('unavailable')
    expect(result.sections.find(s => s.table === 'inbound_order')?.truncated).toBe(true)
  })
})
