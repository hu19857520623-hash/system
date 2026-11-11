import { InboundService } from './inbound.service'
import { fetchOmsInboundRows } from './oms-inbound-bridge.util'

function fixture(erpCount = 5001, omsCount = 0) {
  const stamp = new Date('2026-11-11T00:00:00Z')
  const erp = Array.from({ length: erpCount }, (_, i) => ({ id: BigInt(i + 1), inboundNo: `E-${String(i + 1).padStart(5, '0')}`,
    createdAt: stamp, status: 'pending_putaway', warehouseCode: 'WMS-JHB-01', items: [] }))
  const oms = Array.from({ length: omsCount }, (_, i) => ({ id: `id-${i}`, inboundNo: `O-${String(i + 1).padStart(5, '0')}`,
    status: 'partial', createdAt: stamp.toISOString(), lineItems: JSON.stringify([{ sku: 'OMS-SKU', qty: 2 }]) }))
  const prisma = {
    inboundOrder: {
      findMany: jest.fn(async (query: any) => {
        let rows = erp
        if (query.where?.inboundNo?.in) rows = rows.filter(row => query.where.inboundNo.in.includes(row.inboundNo))
        if (query.where?.id?.in) rows = rows.filter(row => query.where.id.in.includes(row.id))
        return rows.slice(query.skip || 0, query.take ? (query.skip || 0) + query.take : undefined)
      }),
      count: jest.fn(async () => erp.length),
    },
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => sql.includes('i.id IN') ? oms.filter(row => params.includes(row.id)) : oms),
  }
  const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, null as any)
  jest.spyOn(service as any, 'loadPlatformScanIndex').mockResolvedValue(new Map())
  return { service, prisma, erp, oms }
}

describe('complete inbound pagination', () => {
  it('warehouse page 51 contains order 5001 and reports the complete filtered count', async () => {
    const { service, prisma } = fixture()
    const result = await service.list({ warehouseCode: 'WMS-JHB-01', status: 'pending_putaway', page: 51, pageSize: 100 } as any)
    expect(result.total).toBe(5001)
    expect(result.items.map(row => row.inboundNo)).toEqual(['E-05001'])
    expect(prisma.inboundOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5000, take: 100 }))
    expect(prisma.inboundOrder.count).toHaveBeenCalledWith({ where: { warehouseCode: 'WMS-JHB-01', status: 'pending_putaway' } })
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('merges over 5000 ERP and OMS rows, orders tied timestamps, and hydrates only the selected page', async () => {
    const { service, prisma } = fixture(5001, 5001)
    const result = await service.list({ status: 'pending_putaway', page: 51, pageSize: 100 } as any)
    expect(result.total).toBe(10002)
    expect(result.items).toHaveLength(100)
    expect(result.items[0].inboundNo).toBe('E-05001')
    expect(result.items[1].inboundNo).toBe('O-00001')
    expect(result.items[99].inboundNo).toBe('O-00099')
    expect((result.items[1] as any).items[0]).toMatchObject({ sku: 'OMS-SKU', expectedQty: 2 })
    const detail = prisma.inboundOrder.findMany.mock.calls.find(([q]) => q.include)?.[0]
    expect(detail.where.id.in).toEqual([5001n])
    expect(detail.where.status).toBe('pending_putaway')
    const omsDetail = prisma.$queryRawUnsafe.mock.calls.find(([sql]) => sql.includes('i.id IN'))!
    expect(omsDetail[0]).not.toMatch(/LIMIT 5000/)
    expect(omsDetail[0]).toContain('i.id IN')
    expect(omsDetail.slice(1).filter(v => String(v).startsWith('id-'))).toHaveLength(99)
    const linkage = prisma.inboundOrder.findMany.mock.calls.filter(([q]) => q.where.inboundNo?.in)
    expect(linkage).toHaveLength(6)
    expect(linkage.every(([q]) => q.where.inboundNo.in.length <= 1000)).toBe(true)
    const last = await service.list({ status: 'pending_putaway', page: 101, pageSize: 100 } as any)
    expect(last.items.map(row => row.inboundNo)).toEqual(['O-05000', 'O-05001'])
    expect(last.total).toBe(10002)
  })

  it('does not return a partial successful page if a selected order disappears before detail read', async () => {
    const { service, prisma } = fixture(1)
    const find = prisma.inboundOrder.findMany.getMockImplementation()!
    prisma.inboundOrder.findMany.mockImplementation(query => query.include ? Promise.resolve([]) : find(query))
    await expect(service.list({ page: 1, pageSize: 20 } as any)).rejects.toThrow('入库列表已更新，请刷新后重试')
  })

  it('reports OMS read failures in Chinese instead of pretending the merged list is empty', async () => {
    const { service, prisma } = fixture(0)
    prisma.$queryRawUnsafe.mockRejectedValue(Error('SQL connection lost') as never)
    await expect(service.list({} as any)).rejects.toThrow('无法读取 OMS 入库预报，请稍后重试')
    await expect(fetchOmsInboundRows(prisma as any, {})).rejects.toThrow('无法读取 OMS 入库预报，请稍后重试')
  })
})
