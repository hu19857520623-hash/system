export type InboundDimensions = {
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
}

export type InboundFreightLine = InboundDimensions & {
  sku: string
  expectedQty: number
  [key: string]: unknown
}

export function calculateLineCbm(line: InboundDimensions & { expectedQty?: number | null }): number {
  const length = Number(line.lengthCm) || 0
  const width = Number(line.widthCm) || 0
  const height = Number(line.heightCm) || 0
  const quantity = Number(line.expectedQty) || 0
  if (!length || !width || !height || !quantity) return 0
  return (length * width * height * quantity) / 1_000_000
}

export function calculateCbmLabel(
  items: Array<{ sku: string; expectedQty?: number | null }>,
  dimensionsBySku: Map<string, InboundDimensions>,
): string {
  let total = 0
  let hasDimensions = false
  for (const item of items) {
    const dimensions = dimensionsBySku.get(item.sku)
    if (!dimensions) continue
    const lineCbm = calculateLineCbm({ ...dimensions, expectedQty: item.expectedQty })
    if (!lineCbm) continue
    total += lineCbm
    hasDimensions = true
  }
  return hasDimensions ? total.toFixed(3) : '—'
}

export function allocateSeaFreight<T extends InboundFreightLine>(
  lines: T[],
  totalFreight: number,
) {
  const enriched = lines
    .filter((line) => line.sku && line.expectedQty > 0)
    .map((line) => ({ ...line, lineCbm: calculateLineCbm(line) }))
  const totalCbm = enriched.reduce((sum, line) => sum + line.lineCbm, 0)

  return enriched.map((line) => {
    const ratio = totalFreight > 0 && totalCbm > 0 ? line.lineCbm / totalCbm : 0
    const lineFreight = totalFreight * ratio
    return {
      ...line,
      volumePct: ratio * 100,
      lineFreight,
      unitFreight: line.expectedQty ? lineFreight / line.expectedQty : 0,
    }
  })
}
