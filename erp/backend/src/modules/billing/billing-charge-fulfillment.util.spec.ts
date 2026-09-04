import {
  applyDestinationSqlFilter,
  formatSkuSummary,
  inboundChargeFulfillment,
  outboundChargeFulfillment,
  resolveDestinationFilter,
  returnChargeFulfillment,
} from './billing-charge-fulfillment.util'

describe('billing charge fulfillment', () => {
  it('shows Takealot hub city and SKU qty from outbound', () => {
    const result = outboundChargeFulfillment({
      fbaWarehouse: 'JHB1',
      destType: 'fba',
      warehouseCode: 'WMS-JHB-01',
      items: [
        { sku: 'SKU-A', productName: '蓝牙耳机', qty: 4, pickedQty: 3 },
        { sku: 'SKU-B', productName: '', qty: 0, pickedQty: 0 },
      ],
    })
    expect(result.destination).toBe('jhb1 · 约翰内斯堡')
    expect(result.skuItems).toEqual([{ sku: 'SKU-A', productName: '蓝牙耳机', quantity: 3 }])
    expect(formatSkuSummary(result.skuItems)).toBe('SKU-A×3')
  })

  it('resolves hub filters to Takealot FBA codes and city needles', () => {
    expect(resolveDestinationFilter('jhb1')?.fbaCodes).toEqual(['JHB1'])
    expect(resolveDestinationFilter('jhb1 · 约翰内斯堡')?.likes).toEqual(expect.arrayContaining(['约翰内斯堡', 'Johannesburg']))
    expect(resolveDestinationFilter('本地配送')?.destTypes).toEqual(['local'])
    expect(resolveDestinationFilter('Cape Town')?.likes).toEqual(['Cape Town'])
    expect(resolveDestinationFilter('all')).toBeNull()
  })

  it('builds an OR clause for destination SQL filters', () => {
    const conds: string[] = []
    const params: unknown[] = []
    applyDestinationSqlFilter(conds, params, 'jhb1')
    expect(conds).toHaveLength(1)
    expect(conds[0]).toContain('dest_ob.fba_warehouse')
    expect(conds[0]).toContain('dest_wh.city LIKE ?')
    expect(params).toContain('JHB1')
    expect(params).toContain('%Johannesburg%')
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

  it('maps return warehouse to hub label', () => {
    const result = returnChargeFulfillment({
      returnWarehouse: 'CPT1',
      items: [{ sku: 'RT-1', productName: '退件', quantity: 1 }],
    })
    expect(result.destination).toBe('cpt1 · 开普敦')
    expect(result.skuItems[0].quantity).toBe(1)
  })
})
