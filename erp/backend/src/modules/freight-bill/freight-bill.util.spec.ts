import { allocateFreightArea, mergeCargoItems, parseCargoItems, readStoredSkuDetails } from './freight-bill.util'

describe('freight-bill.util', () => {
  it('merges duplicate SKUs and skips empty rows', () => {
    expect(mergeCargoItems([
      { sku: 'A', productName: 'Alpha', qty: 2 },
      { sku: 'A', qty: 3 },
      { sku: 'B', quantity: 1 },
      { sku: '', qty: 9 },
    ])).toEqual([
      { sku: 'A', productName: 'Alpha', qty: 5 },
      { sku: 'B', productName: '', qty: 1 },
    ])
  })

  it('allocates sea freight area by SKU volume', () => {
    const products = new Map([
      ['A', { lengthCm: 50, widthCm: 40, heightCm: 20, productName: 'Alpha' }],
      ['B', { lengthCm: 50, widthCm: 40, heightCm: 20, productName: 'Beta' }],
    ])
    const result = allocateFreightArea(
      [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 2 }],
      products,
    )
    expect(result.totalAreaCbm).toBe(0.16)
    expect(result.items).toEqual([
      { sku: 'A', productName: 'Alpha', qty: 2, areaCbm: 0.08, sharePct: 50 },
      { sku: 'B', productName: 'Beta', qty: 2, areaCbm: 0.08, sharePct: 50 },
    ])
  })

  it('parses cargo JSON and stored snapshots', () => {
    expect(parseCargoItems([{ sku: 'A', qty: 4, productName: 'Alpha' }])).toEqual([
      { sku: 'A', productName: 'Alpha', qty: 4, quantity: 4 },
    ])
    expect(readStoredSkuDetails({
      totalAreaCbm: 0.08,
      items: [{ sku: 'A', productName: 'Alpha', qty: 2, areaCbm: 0.08, sharePct: 100 }],
    })?.items[0]).toMatchObject({ sku: 'A', qty: 2, areaCbm: 0.08 })
  })
})
