import { matchesOmsInventoryQuantity, omsInventoryWithoutErpDuplicates } from './inventory-source.util'

describe('inventory source reconciliation', () => {
  it('excludes customer catalog holdings even when their owner differs or no ERP row matches', () => {
    const holdings = [
      { sku: 'FUR-LVR-SID-011', customerCode: 'TKL0444', warehouseCode: 'WMS-JHB-01', stockSource: 'catalog', availableQty: 191 },
      { sku: 'CATALOG-ONLY', customerCode: 'TKL0001', warehouseCode: 'jhb1', stockSource: 'catalog', availableQty: 9 },
    ]
    expect(omsInventoryWithoutErpDuplicates(holdings, [])).toEqual([])
    expect(omsInventoryWithoutErpDuplicates(holdings, [
      { sku: 'FUR-LVR-SID-011', warehouseCode: 'WMS-JHB-01' },
    ])).toEqual([])
  })
  const erp = [{ sku: 'TKL005-713105', customerCode: 'TKL005', warehouseCode: 'WMS-JHB-01', availableQty: 11 }]
  it('removes the OMS mirror even when quantity filters exclude the ERP row', () => {
    const mirror = { sku: 'TKL005-713105', customerCode: 'TKL005', warehouseCode: 'jhb1', availableQty: 12 }
    expect(omsInventoryWithoutErpDuplicates([mirror], erp)).toEqual([])
    expect(erp[0].availableQty).toBe(11)
  })
  it('preserves other owners, warehouses, internal SKUs, and OMS-only stock', () => {
    const rows = [
      { sku: 'TKL005-713105', customerCode: 'TKL006', warehouseCode: 'jhb1' },
      { sku: 'TKL005-713105', customerCode: 'TKL005', warehouseCode: 'CPT' },
      { sku: '713105', customerCode: 'TKL005', warehouseCode: 'jhb1' },
      { sku: 'TKL005-NEW', customerCode: 'TKL005', warehouseCode: 'jhb1' },
      { sku: 'TKL005-713105', warehouseCode: 'jhb1' },
    ]
    expect(omsInventoryWithoutErpDuplicates(rows, erp)).toEqual(rows)
  })

  it('excludes copied warehouse stock while preserving the customer’s separate inbound quantities', () => {
    const catalog = { sku: 'FUR-LVR-SID-011', customerCode: 'TKL', warehouseCode: 'WMS-JHB-01' }
    const mirror = { ...catalog, id: 'oms-erp-o-stale', customerCode: 'TKL0444', stockSource: 'owned', availableQty: 200, lockedQty: 2, totalQty: 202 }
    expect(omsInventoryWithoutErpDuplicates([mirror], [catalog])).toEqual([])
    const [pending] = omsInventoryWithoutErpDuplicates([{ ...mirror, inTransitQty: 40 }], [catalog])
    expect(pending).toMatchObject({ availableQty: 0, lockedQty: 0, totalQty: 0, inTransitQty: 40 })
    expect(matchesOmsInventoryQuantity(pending, { onlyAvailable: true })).toBe(false)
  })
})
