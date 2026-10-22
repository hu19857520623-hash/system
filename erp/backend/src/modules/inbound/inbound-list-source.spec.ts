import { InboundService } from './inbound.service'

describe('inbound list ERP authority', () => {
  function fixture(linked: string[]) {
    const prisma = {
      inboundOrder: { findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(linked.map(inboundNo => ({ inboundNo }))) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { id: 'old', inboundNo: 'RV-OLD', status: 'partial', createdAt: '2026-09-24', customerCode: 'TKL005' },
        { id: 'only', inboundNo: 'RV-ONLY', status: 'partial', createdAt: '2026-09-25', customerCode: 'TKL005' },
      ]),
    }
    const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service as any, 'loadPlatformScanIndex').mockResolvedValue(new Map())
    return { service, prisma }
  }

  it('hides a stale OMS partial record when its ERP order is outside the selected status', async () => {
    const { service, prisma } = fixture(['RV-OLD'])
    const result = await service.list({ status: 'pending_putaway' } as any)
    expect(result.items.map((row: any) => row.inboundNo)).toEqual(['RV-ONLY'])
    expect(result.total).toBe(1)
    expect(prisma.inboundOrder.findMany.mock.calls[1][0].where).toEqual({ inboundNo: { in: ['RV-OLD', 'RV-ONLY'] } })
  })

  it('preserves OMS records that have no ERP work order', async () => {
    const { service } = fixture([])
    const result = await service.list({ status: 'pending_putaway' } as any)
    expect(result.items.map((row: any) => row.inboundNo)).toEqual(['RV-ONLY', 'RV-OLD'])
    expect(result.total).toBe(2)
  })

  it('filters shipments by the source warehouse and never merges OMS reservations', async () => {
    const { service, prisma } = fixture([])
    prisma.inboundOrder.findMany.mockReset().mockResolvedValue([
      { id: 1, inboundNo: 'ERP-1', sourceWarehouseCode: 'LOG-01', omsCustomerCode: 'TKL005', status: 'pending_receipt', createdAt: new Date(), items: [] },
    ] as any)
    const result = await service.list({ source: 'erp_shipment' } as any)
    expect(prisma.inboundOrder.findMany.mock.calls[0][0].where.AND).toEqual([
      { sourceWarehouseCode: { not: null } }, { sourceWarehouseCode: { not: '' } },
    ])
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
    expect(result.total).toBe(1)
    expect((result.items[0] as any).sourceKind).toBe('erp_shipment')
  })

  it('restricts customer reservations to orders without a transfer warehouse', async () => {
    const { service, prisma } = fixture([])
    const result = await service.list({ source: 'oms_customer', status: 'pending_putaway' } as any)
    expect(prisma.inboundOrder.findMany.mock.calls[0][0].where).toEqual({
      omsCustomerCode: { not: null },
      AND: [{ OR: [{ sourceWarehouseCode: null }, { sourceWarehouseCode: '' }] }],
      status: 'pending_putaway',
    })
    expect(result.items.every((row: any) => row.sourceKind === 'oms_customer')).toBe(true)
    expect(result.total).toBe(2)
  })

  it('rejects unknown sources instead of silently returning all orders', async () => {
    const { service, prisma } = fixture([])
    await expect(service.list({ source: 'unknown' } as any)).rejects.toThrow('无效的入库单来源')
    expect(prisma.inboundOrder.findMany).not.toHaveBeenCalled()
  })

  it('excludes unsubmitted OMS drafts from warehouse rows, totals and ERP linkage checks', async () => {
    const { service, prisma } = fixture([])
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'draft', inboundNo: 'OMS-DRAFT', status: 'draft', createdAt: '2026-09-26', customerCode: 'TKL005' },
      { id: 'sent', inboundNo: 'OMS-SENT', status: 'on_the_way', createdAt: '2026-09-25', customerCode: 'TKL005' },
    ])
    const result = await service.list({ source: 'all' } as any)
    expect(result.items.map(r => r.inboundNo)).toEqual(['OMS-SENT'])
    expect(result.total).toBe(1)
    expect(prisma.inboundOrder.findMany.mock.calls[1][0].where).toEqual({ inboundNo: { in: ['OMS-SENT'] } })
  })

  it.each([undefined, 'all', 'oms_customer'])('excludes drafts before pagination and counting for source %s', async source => {
    const { service, prisma } = fixture([])
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'draft', inboundNo: 'REF-DRAFT', status: 'draft', createdAt: '2026-09-29' },
      { id: 'legacy', inboundNo: 'REF-LEGACY', status: ' OMS_DRAFT ', createdAt: '2026-09-28' },
      { id: 'sent', inboundNo: 'REF-SENT', status: 'on_the_way', createdAt: '2026-09-27' },
      { id: 'receiving', inboundNo: 'REF-RECEIVING', status: 'receiving', createdAt: '2026-09-26' },
    ])
    const result = await service.list({ source, status: 'all', keyword: 'REF', page: 2, pageSize: 1 } as any)
    expect(result.items.map(row => row.inboundNo)).toEqual(['REF-RECEIVING'])
    expect(result.total).toBe(2)
    expect(result.page).toBe(2)
    expect(prisma.inboundOrder.findMany.mock.calls[0][0].where).not.toHaveProperty('status')
    expect(prisma.inboundOrder.findMany.mock.calls[1][0].where).toEqual({
      inboundNo: { in: ['REF-SENT', 'REF-RECEIVING'] },
    })
  })

  it.each(['draft', 'oms_draft'])('does not merge OMS rows when explicitly requesting %s', async status => {
    const { service, prisma } = fixture([])
    const result = await service.list({ status, keyword: 'REF-DRAFT' } as any)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })
})
