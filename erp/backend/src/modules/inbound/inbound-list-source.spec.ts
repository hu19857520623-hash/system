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
})
