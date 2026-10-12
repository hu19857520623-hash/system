import { omsInventoryWithoutErpDuplicates } from './inventory-source.util'

describe('inventory source reconciliation', () => {
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
})
