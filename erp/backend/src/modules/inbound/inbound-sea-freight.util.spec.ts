import {
  allocateInboundSeaFreight,
  parseInboundSeaFreightTag,
  parseSeaFreightMode,
  patchInboundRemarkSeaFreight,
} from './inbound-sea-freight.util'

describe('inbound sea freight', () => {
  it('allocates by volume', () => {
    const rows = allocateInboundSeaFreight(
      [
        { sku: 'A', expectedQty: 1, lengthCm: 100, widthCm: 100, heightCm: 100 },
        { sku: 'B', expectedQty: 2, lengthCm: 100, widthCm: 100, heightCm: 100 },
      ],
      300,
    )
    expect(rows[0].unitFreight).toBe(100)
    expect(rows[1].unitFreight).toBe(100)
    expect(rows.reduce((sum, row) => sum + row.lineFreight, 0)).toBeCloseTo(300)
  })

  it('writes and clears the remark tag without dropping other meta', () => {
    const withTag = patchInboundRemarkSeaFreight('入仓:WH-1 客户加急', { mode: 'lcl', total: 1280 })
    expect(withTag).toBe('入仓:WH-1 客户加急 海运:LCL/1280')
    expect(parseInboundSeaFreightTag(withTag)).toEqual({ mode: 'lcl', total: 1280 })
    expect(patchInboundRemarkSeaFreight(withTag, null)).toBe('入仓:WH-1 客户加急')
  })

  it('normalizes mode', () => {
    expect(parseSeaFreightMode('FCL')).toBe('fcl')
    expect(parseSeaFreightMode('')).toBe('lcl')
  })
})
