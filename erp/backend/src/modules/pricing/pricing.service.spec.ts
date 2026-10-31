import { PricingService } from './pricing.service'
jest.mock('./oms-catalog-sync.util', () => ({ pushCatalogStockToOms: jest.fn().mockResolvedValue(undefined) }))

describe('catalog damaged procurement pipeline', () => {
  it('scopes damage to eligible purchase orders, keeps original purchase totals and leaves actual open shipments in transit', async () => {
    const db:any={
      purchaseOrderItem:{findMany:jest.fn().mockResolvedValue([{poId:301n,sku:'AUDIT-A',quantity:4},{poId:303n,sku:'AUDIT-A',quantity:1}])},
      inboundOrderItem:{findMany:jest.fn().mockResolvedValue([{sku:'AUDIT-A',expectedQty:3,actualQty:3,order:{status:'completed'}},{sku:'AUDIT-A',expectedQty:1,actualQty:null,order:{status:'pending_receipt'}}])},
      logisticsReceiptItem:{findMany:jest.fn().mockResolvedValue([{sku:'AUDIT-A',damagedQty:1}])},
    }
    const service=new PricingService(db,{} as any,{} as any)
    const result=await (service as any).loadCatalogPipelineQtyBySku(['TKL-AUDIT-A'])
    expect(result.get('TKL-AUDIT-A')).toEqual({purchaseQty:5,inboundExpectedTotal:4,openInboundRemaining:1,inTransitQty:1})
    expect(db.purchaseOrderItem.findMany.mock.calls[0][0].where.order.status.notIn).toContain('cancelled')
    expect(db.logisticsReceiptItem.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({damagedQty:{gt:0},receipt:{poId:{in:[301n,303n]}}})}))
    db.inboundOrderItem.findMany.mockResolvedValue([{sku:'AUDIT-A',expectedQty:4,actualQty:4,order:{status:'completed'}}])
    const completed=(await (service as any).loadCatalogPipelineQtyBySku(['TKL-AUDIT-A'])).get('TKL-AUDIT-A')
    expect(completed.inTransitQty).toBe(0)
    expect((service as any).serialize({id:1n,sku:'TKL-AUDIT-A',purchaseQty:5},undefined,completed).inTransitQty).toBe(0)
  })
  it('does not read unrelated historical damage when there are no eligible purchases', async()=>{
    const db:any={purchaseOrderItem:{findMany:async()=>[]},inboundOrderItem:{findMany:async()=>[]},logisticsReceiptItem:{findMany:jest.fn()}}
    const service=new PricingService(db,{} as any,{} as any)
    expect((await (service as any).loadCatalogPipelineQtyBySku(['TKL-A'])).get('TKL-A').inTransitQty).toBe(0)
    expect(db.logisticsReceiptItem.findMany).not.toHaveBeenCalled()
  })
})

describe('repricing original version', () => {
  const version='2026-10-30T00:00:00.000Z'
  function setup() {
    const row={id:1n,sku:'AUDIT',pricingStatus:'synced',updatedAt:new Date(version),finalPrice:10,marketPrice:30}
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
  it('retains the current reference price in both pricing and its required audit snapshot when only the sale price changes',async()=>{
    const {tx,service}=setup()
    await service.reprice(1,{price:20,expectedUpdatedAt:version},'验收')
    expect(tx.productPricing.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({marketPrice:30,finalPrice:20})}))
    expect(tx.productPriceRecord.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({marketPrice:30,price:20})}))
    expect(tx.productPricingHistory.create.mock.calls[0][0].data.detail).toContain('市场参考 R30')
  })
  it.each([null,0,-1,1.001,NaN,Infinity,'bad'])('rejects invalid explicit reference price %s before any pricing/history write',async marketPrice=>{
    const {tx,service}=setup()
    await expect(service.reprice(1,{price:20,marketPrice,expectedUpdatedAt:version},'验收')).rejects.toThrow('市场参考价')
    expect(tx.productPricing.update).not.toHaveBeenCalled()
    expect(tx.productPriceRecord.create).not.toHaveBeenCalled()
    expect(tx.productPricingHistory.create).not.toHaveBeenCalled()
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
    db.$queryRaw=jest.fn();db.$transaction=jest.fn((fn:any)=>fn(db))
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
