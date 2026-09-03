export type CapacityAlertLevel = 'critical' | 'high' | 'warning' | 'normal'

export function parseVolumeCbm(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 10000) / 10000
}

/** 仓级上限只用 warehouse.total_volume_cbm，不用库位加总冒充。 */
export function warehouseCapacityCap(totalVolumeCbm: unknown): number {
  return parseVolumeCbm(totalVolumeCbm) ?? 0
}

export function capacityAlertLevel(rate: number): CapacityAlertLevel {
  if (rate >= 0.95) return 'critical'
  if (rate >= 0.9) return 'high'
  if (rate >= 0.8) return 'warning'
  return 'normal'
}

export function capacityRate(used: number, cap: number) {
  if (!(cap > 0)) return 0
  return used / cap
}

function roundCbm(value: number) {
  return Math.round((Number(value) || 0) * 10000) / 10000
}

function roundPct(rate: number) {
  return Math.round(rate * 1000) / 10
}

export function summarizeWarehouseCapacity(input: {
  warehouseCode: string
  warehouseName?: string
  totalVolumeCbm: unknown
  usedVolumeCbm: number
  pendingVolumeCbm: number
  locationCount: number
  locationMaxVolumeCbm: number
  unknownDimensionQty: number
}) {
  const cap = warehouseCapacityCap(input.totalVolumeCbm)
  const used = Number(input.usedVolumeCbm) || 0
  const pending = Number(input.pendingVolumeCbm) || 0
  const projected = used + pending
  const usageRate = capacityRate(used, cap)
  const projectedRate = capacityRate(projected, cap)
  return {
    warehouseCode: input.warehouseCode,
    warehouseName: input.warehouseName || input.warehouseCode,
    totalVolumeCbm: cap,
    capacitySet: cap > 0,
    usedVolumeCbm: roundCbm(used),
    pendingVolumeCbm: roundCbm(pending),
    projectedVolumeCbm: roundCbm(projected),
    locationCount: input.locationCount,
    locationMaxVolumeCbm: roundCbm(Number(input.locationMaxVolumeCbm) || 0),
    unknownDimensionQty: Number(input.unknownDimensionQty) || 0,
    usageRate: roundPct(usageRate),
    projectedRate: roundPct(projectedRate),
    alertLevel: cap > 0 ? capacityAlertLevel(Math.max(usageRate, projectedRate)) : 'normal' as CapacityAlertLevel,
  }
}
