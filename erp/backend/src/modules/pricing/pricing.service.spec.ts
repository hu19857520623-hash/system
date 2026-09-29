import { PricingService } from './pricing.service'

describe('PricingService historical display fallbacks', () => {
  it('replaces corrupted or empty price notes with a readable label', () => {
    const service = new PricingService({} as any, {} as any, {} as any)
    const serialized = (service as any).serialize({
      id: 1n,
      sku: 'TKL-TEST-001',
      productName: 'Test',
      purchaseQty: 0,
      inboundQty: 0,
      soldQty: 0,
      visibleStockQty: 0,
      pricingStatus: 'pending_pricing',
      shareStatus: 'enabled',
      histories: [],
      priceRecords: [
        { createdAt: new Date('2026-01-01'), marketPrice: 10, price: 12, operator: 'admin', note: '????' },
        { createdAt: new Date('2026-01-02'), marketPrice: 11, price: 13, operator: 'admin', note: '' },
        { createdAt: new Date('2026-01-03'), marketPrice: 12, price: 14, operator: 'admin', note: '促销调整' },
      ],
    })

    expect(serialized.priceRecords.map((record: any) => record.note)).toEqual([
      '手动调价',
      '手动调价',
      '促销调整',
    ])
  })
})
