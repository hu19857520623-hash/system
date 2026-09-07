import {
  applyDestinationSqlFilter,
  formatSkuSummary,
  inboundChargeFulfillment,
  outboundChargeFulfillment,
  resolveDestinationFilter,
  returnChargeFulfillment,
} from './billing-charge-fulfillment.util'

describe('billing charge fulfillment', () => {
  it('shows short Takealot hub code and SKU qty from outbound', () => {
    const result = outboundChargeFulfillment({
      fbaWarehouse: 'JHB1',
      destType: 'fba',
      warehouseCode: 'WMS-JHB-01',
      items: [
        { sku: 'SKU-A', productName: '蓝牙耳机', qty: 4, pickedQty: 3 },
        { sku: 'SKU-B', productName: '', qty: 0, pickedQty: 0 },
      ],
    })
    expect(result.destination).toBe('JHB')
    expect(result.skuItems).toEqual([{ sku: 'SKU-A', productName: '蓝牙耳机', quantity: 3 }])
    expect(formatSkuSummary(result.skuItems)).toBe('SKU-A×3')
  })

  it('resolves hub filters to exact Takealot destination codes', () => {
    expect(resolveDestinationFilter('jhb1')?.fbaCodes).toEqual(['JHB', 'JHB1'])
    expect(resolveDestinationFilter('JHB3')?.fbaCodes).toEqual(['JHB3'])
    expect(resolveDestinationFilter('JHB')?.fbaCodes).toEqual(['JHB', 'JHB1'])
    expect(resolveDestinationFilter('JHB3')?.likes).toEqual([])
    expect(resolveDestinationFilter('本地配送')?.destTypes).toEqual(['local'])
    expect(resolveDestinationFilter('Cape Town')?.likes).toEqual(['Cape Town'])
    expect(resolveDestinationFilter('all')).toBeNull()
  })

  it('keeps JHB and JHB3 as separate destination categories', () => {
    expect(outboundChargeFulfillment({ fbaWarehouse: 'JHB' }).destination).toBe('JHB')
    expect(outboundChargeFulfillment({ fbaWarehouse: 'JHB3' }).destination).toBe('JHB3')
    expect(resolveDestinationFilter('JHB')?.fbaCodes).not.toContain('JHB3')
    expect(resolveDestinationFilter('JHB3')?.fbaCodes).not.toContain('JHB')
  })

  it('builds an OR clause for destination SQL filters', () => {
    const conds: string[] = []
    const params: unknown[] = []
    applyDestinationSqlFilter(conds, params, 'JHB3')
    expect(conds).toHaveLength(1)
    expect(conds[0]).toContain('dest_ob.fba_warehouse')
    expect(conds[0]).not.toContain('dest_wh.city LIKE ?')
    expect(params).toEqual(['JHB3'])
  })

  it('appends recipient city and street for local delivery', () => {
    const result = outboundChargeFulfillment({
      destType: 'local',
      recipientJson: JSON.stringify({ city: 'Cape Town', address1: '12 Long St' }),
      items: [{ sku: 'SKU-C', productName: '纸箱', qty: 2 }],
    })
    expect(result.destination).toBe('本地配送 · Cape Town · 12 Long St')
    expect(result.skuItems[0]).toEqual({ sku: 'SKU-C', productName: '纸箱', quantity: 2 })
  })

  it('infers JHB from warehouse code when fba warehouse is missing', () => {
    const result = outboundChargeFulfillment({
      warehouseCode: 'WMS-JHB-01',
      items: [{ sku: 'SKU-D', productName: '商品', qty: 1 }],
    })
    expect(result.destination).toBe('JHB')
  })

  it('uses inbound warehouse as destination and actual qty', () => {
    const result = inboundChargeFulfillment({
      warehouseCode: 'WMS-JHB-01',
      warehouseName: '约翰内斯堡仓',
      warehouseCity: '约翰内斯堡',
      items: [{ sku: 'IN-1', productName: '配件', expectedQty: 10, actualQty: 8 }],
    })
    expect(result.destination).toBe('约翰内斯堡仓 · 约翰内斯堡')
    expect(result.skuItems).toEqual([{ sku: 'IN-1', productName: '配件', quantity: 8 }])
  })

  it('maps return warehouse to short hub code', () => {
    const result = returnChargeFulfillment({
      returnWarehouse: 'CPT1',
      items: [{ sku: 'RT-1', productName: '退件', quantity: 1 }],
    })
    expect(result.destination).toBe('CPT1')
    expect(result.skuItems[0].quantity).toBe(1)
  })
})
