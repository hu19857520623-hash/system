export type SeaFreightMode = 'lcl' | 'fcl'

export type SeaFreightAllocLine = {
  sku: string
  expectedQty: number
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
}

export function parseSeaFreightMode(raw: unknown): SeaFreightMode {
  return String(raw || '').trim().toLowerCase() === 'fcl' ? 'fcl' : 'lcl'
}

export function lineCbm(line: SeaFreightAllocLine): number {
  const length = Number(line.lengthCm) || 0
  const width = Number(line.widthCm) || 0
  const height = Number(line.heightCm) || 0
  const qty = Number(line.expectedQty) || 0
  if (!length || !width || !height || !qty) return 0
  return (length * width * height * qty) / 1_000_000
}

export function allocateInboundSeaFreight<T extends SeaFreightAllocLine>(lines: T[], totalFreight: number) {
  const total = Number(totalFreight) || 0
  const enriched = lines.map((line) => ({ ...line, lineCbm: lineCbm(line) }))
  const totalCbm = enriched.reduce((sum, line) => sum + line.lineCbm, 0)
  return enriched.map((line) => {
    const ratio = total > 0 && totalCbm > 0 ? line.lineCbm / totalCbm : 0
    const lineFreight = Math.round(total * ratio * 100) / 100
    const unitFreight = line.expectedQty > 0 ? Math.round((lineFreight / line.expectedQty) * 100) / 100 : 0
    return {
      ...line,
      volumePct: ratio * 100,
      lineFreight,
      unitFreight,
    }
  })
}

const SEA_FREIGHT_TAG = /\s*海运:(LCL|FCL)\/[^\s]+/gi

export function patchInboundRemarkSeaFreight(
  remark: string | null | undefined,
  next: { mode: SeaFreightMode; total: number } | null,
): string {
  const stripped = String(remark || '').replace(SEA_FREIGHT_TAG, '').replace(/\s+/g, ' ').trim()
  if (!next || !(next.total > 0)) return stripped
  const tag = `海运:${next.mode.toUpperCase()}/${next.total}`
  return stripped ? `${stripped} ${tag}` : tag
}

export function parseInboundSeaFreightTag(remark?: string | null): { mode: SeaFreightMode; total: number } | null {
  const match = String(remark || '').match(/海运:(LCL|FCL)\/([0-9.]+)/i)
  if (!match) return null
  const total = Number(match[2])
  if (!Number.isFinite(total) || total <= 0) return null
  return { mode: match[1].toLowerCase() === 'fcl' ? 'fcl' : 'lcl', total }
}
