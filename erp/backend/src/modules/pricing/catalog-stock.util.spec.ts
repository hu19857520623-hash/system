import { receivedCatalogQtyPatch, remainingCatalogStock } from './catalog-stock.util'

describe('receivedCatalogQtyPatch', () => {
  it('rewrites inboundQty from expected to actual', () => {
    expect(receivedCatalogQtyPatch({ inboundQty: 198 }, 2)).toEqual({ inboundQty: 2 })
  })

  it('clamps visible stock that still reflects the ASN qty', () => {
    expect(receivedCatalogQtyPatch({ inboundQty: 198, visibleStockQty: 198 }, 2)).toEqual({
      inboundQty: 2,
      visibleStockQty: 2,
    })
  })

  it('does not raise a smaller visible stock', () => {
    expect(receivedCatalogQtyPatch({ inboundQty: 198, visibleStockQty: 1 }, 2)).toEqual({ inboundQty: 2 })
  })

  it('no-ops when already matching actual', () => {
    expect(receivedCatalogQtyPatch({ inboundQty: 2, visibleStockQty: 2 }, 2)).toBeNull()
  })

  it('allows zero receive to clear catalog qty', () => {
    expect(receivedCatalogQtyPatch({ inboundQty: 20 }, 0)).toEqual({ inboundQty: 0 })
  })
})

describe('remainingCatalogStock after short receive', () => {
  it('uses inboundQty when visible is unset', () => {
    expect(remainingCatalogStock({ inboundQty: 2, soldQty: 0 })).toBe(2)
  })

  it('uses clamped visible stock', () => {
    expect(remainingCatalogStock({ inboundQty: 2, visibleStockQty: 2, soldQty: 0 })).toBe(2)
  })
})
