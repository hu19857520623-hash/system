import { InboundService } from './inbound.service'

describe('PDA detail for legacy closed inbound orders', () => {
  it.each(['completed', 'confirmed', 'cancelled'])('does not backfill missing cartons for %s', async status => {
    const row = {
      id: 11n, inboundNo: 'RV-260101-0001', status, putawayItems: [],
      items: [{ id: 1n, productId: 3n, sku: 'TEST-SKU', expectedQty: 1 }],
    }
    const prisma = {
      inboundOrder: { findUnique: jest.fn().mockResolvedValue(row) },
      inboundCarton: { findMany: jest.fn().mockResolvedValue([]) },
      operationLog: { findFirst: jest.fn().mockResolvedValue(null) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    }
    const pricing = { applyInboundActual: jest.fn() }
    const service = new InboundService(prisma as any, null as any, null as any, pricing as any, null as any, null as any)
    const persistCartons = jest.spyOn(service as any, 'persistCartons').mockResolvedValue(undefined)
    jest.spyOn(service as any, 'loadPlatformScanIndex').mockResolvedValue(new Map())

    await expect(service.detail(11, { reconcileCatalog: false, backfillClosedCartons: false }))
      .resolves.toMatchObject({ id: 11, status, cartons: [] })
    expect(persistCartons).not.toHaveBeenCalled()
    expect(pricing.applyInboundActual).not.toHaveBeenCalled()
  })
})
