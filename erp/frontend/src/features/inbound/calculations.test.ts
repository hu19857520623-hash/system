import { describe, expect, it } from 'vitest'
import { allocateSeaFreight, calculateCbmLabel, calculateLineCbm } from './calculations'

describe('inbound calculations', () => {
  it('calculates cubic metres for a quantity of packages', () => {
    expect(calculateLineCbm({ lengthCm: 100, widthCm: 50, heightCm: 20, expectedQty: 2 }))
      .toBeCloseTo(0.2)
  })

  it('returns an empty label when dimensions are unavailable', () => {
    expect(calculateCbmLabel([{ sku: 'SKU-1', expectedQty: 2 }], new Map())).toBe('—')
  })

  it('allocates freight proportionally and preserves the total', () => {
    const result = allocateSeaFreight(
      [
        { sku: 'A', expectedQty: 1, lengthCm: 100, widthCm: 100, heightCm: 100 },
        { sku: 'B', expectedQty: 2, lengthCm: 100, widthCm: 100, heightCm: 100 },
      ],
      300,
    )
    expect(result[0].lineFreight).toBeCloseTo(100)
    expect(result[1].lineFreight).toBeCloseTo(200)
    expect(result.reduce((sum, line) => sum + line.lineFreight, 0)).toBeCloseTo(300)
  })
})
