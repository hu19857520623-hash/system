import {
  capacityAlertLevel,
  parseVolumeCbm,
  summarizeWarehouseCapacity,
  warehouseCapacityCap,
} from './management-loop-capacity.util'

describe('warehouse capacity cap', () => {
  it('uses warehouse total_volume_cbm and ignores location sums', () => {
    expect(warehouseCapacityCap(500)).toBe(500)
    expect(warehouseCapacityCap('500.2500')).toBe(500.25)
    expect(warehouseCapacityCap(null)).toBe(0)
    expect(warehouseCapacityCap(undefined)).toBe(0)
    expect(warehouseCapacityCap(-1)).toBe(0)
  })

  it('rejects invalid volume input', () => {
    expect(parseVolumeCbm('')).toBeNull()
    expect(parseVolumeCbm('abc')).toBeNull()
    expect(parseVolumeCbm(-8)).toBeNull()
  })

  it('rates warehouse occupancy against the warehouse cap, not location totals', () => {
    const row = summarizeWarehouseCapacity({
      warehouseCode: 'WMS-JHB-01',
      warehouseName: 'JHB',
      totalVolumeCbm: 500,
      usedVolumeCbm: 400,
      pendingVolumeCbm: 80,
      locationCount: 12,
      locationMaxVolumeCbm: 80,
      unknownDimensionQty: 3,
    })
    expect(row.capacitySet).toBe(true)
    expect(row.usageRate).toBe(80)
    expect(row.projectedRate).toBe(96)
    expect(row.alertLevel).toBe('critical')
    expect(row.locationMaxVolumeCbm).toBe(80)
  })

  it('does not treat location sum as a warehouse cap when unset', () => {
    const row = summarizeWarehouseCapacity({
      warehouseCode: 'WMS-JHB-01',
      totalVolumeCbm: null,
      usedVolumeCbm: 400,
      pendingVolumeCbm: 80,
      locationCount: 12,
      locationMaxVolumeCbm: 80,
      unknownDimensionQty: 0,
    })
    expect(row.capacitySet).toBe(false)
    expect(row.totalVolumeCbm).toBe(0)
    expect(row.usageRate).toBe(0)
    expect(row.projectedRate).toBe(0)
    expect(row.alertLevel).toBe('normal')
  })

  it('maps occupancy thresholds', () => {
    expect(capacityAlertLevel(0.79)).toBe('normal')
    expect(capacityAlertLevel(0.8)).toBe('warning')
    expect(capacityAlertLevel(0.9)).toBe('high')
    expect(capacityAlertLevel(0.95)).toBe('critical')
  })
})
