import { PricingService } from './pricing.service'
jest.mock('./oms-catalog-sync.util', () => ({ pushCatalogStockToOms: jest.fn().mockResolvedValue(undefined) }))

describe('repricing original version', () => {
  const version='2026-10-30T00:00:00.000Z'
  function setup() {
    const row={id:1n,sku:'AUDIT',pricingStatus:'synced',updatedAt:new Date(version),finalPrice:10}
    const tx:any={$queryRaw:jest.fn(),productPricing:{findUnique:jest.fn().mockResolvedValue(row),update:jest.fn()},productPriceRecord:{create:jest.fn()},productPricingHistory:{create:jest.fn()}}
    const db:any={$transaction:jest.fn((fn:any)=>fn(tx))},service=new PricingService(db,{} as any,{} as any)
    jest.spyOn(service,'detail').mockResolvedValue({id:1} as any)
    return {tx,service}
  }
  it.each([undefined,'bad-date','2026-10-29T00:00:00.000Z'])('rejects missing or obsolete version %s without changing pricing/history',async expectedUpdatedAt=>{
    const {tx,service}=setup()
    await expect(service.reprice(1,{price:20,marketPrice:30,expectedUpdatedAt},'验收')).rejects.toThrow('旧页面不能覆盖')
    expect(tx.productPricing.update).not.toHaveBeenCalled();expect(tx.productPriceRecord.create).not.toHaveBeenCalled();expect(tx.productPricingHistory.create).not.toHaveBeenCalled()
  })
  it('accepts current version and always advances it even within the same millisecond',async()=>{
    const {tx,service}=setup();jest.spyOn(Date,'now').mockReturnValue(new Date(version).getTime())
    try {
      await service.reprice(1,{price:20,marketPrice:30,expectedUpdatedAt:version},'验收')
      expect(tx.productPricing.update.mock.calls[0][0].data.updatedAt.getTime()).toBe(new Date(version).getTime()+1)
      expect(tx.productPriceRecord.create).toHaveBeenCalledTimes(1);expect(tx.productPricingHistory.create).toHaveBeenCalledTimes(1)
    } finally {jest.restoreAllMocks()}
  })
})

describe('PricingService historical display fallbacks', () => {
  it.each([
    {receivedGoodQty:0,soldQty:0,shareStatus:'enabled',expected:false},
    {receivedGoodQty:8,soldQty:8,shareStatus:'enabled',expected:false},
    {receivedGoodQty:8,soldQty:1,shareStatus:'enabled',expected:true},
    {receivedGoodQty:8,soldQty:1,shareStatus:'stopped',expected:false},
  ])('ERP展示的下单状态与实收上限一致 %p', data => {
    const service=new PricingService({} as any,{} as any,{} as any)
    const row=(service as any).serialize({id:1n,sku:'TKL-A',visibleStockQty:200,orderableOnOms:true,...data})
    expect(row.orderableOnOms).toBe(data.expected)
    expect(row.catalogStockPool).toBe(data.receivedGoodQty)
    expect(row.visibleStockQty).toBe(200)
  })
  it.each([0, -1, 1.001, null, true, '10.00'])('无效售价%s不能写入并把商品推进不可恢复状态', async price => {
    const db: any = { productPricing: { findUnique: jest.fn().mockResolvedValue({ id: 1n, pricingStatus: 'pending_pricing' }), update: jest.fn() } }
    const service = new PricingService(db, {} as any, {} as any)
    await expect(service.confirmPrice(1, { finalPrice: price, marketPrice: 100, visibleStockQty: 1 }, '验收')).rejects.toThrow()
    db.productPricing.findUnique.mockResolvedValue({ id: 1n, pricingStatus: 'synced' })
    await expect(service.reprice(1, { price }, '验收')).rejects.toThrow()
    expect(db.productPricing.update).not.toHaveBeenCalled()
  })
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
