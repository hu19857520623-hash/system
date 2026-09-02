import { summarizeRemark, summarizeSkus, barcodeMatchesProduct, parseWorkDate, formatWorkDate, resolveCargoType, cargoTypeLabel } from './outbound.policy'

describe('outbound display policy', () => {
  it('summarizes multiple SKUs', () => {
    expect(summarizeSkus([{ sku: 'A' }, { sku: 'B' }])).toBe('A 等 2 SKU')
  })

  it('truncates long remarks at the display boundary', () => {
    const result = summarizeRemark('x'.repeat(41))
    expect(result).toBe(`${'x'.repeat(40)}…`)
  })

  it('matches product barcode or sku for relabel scan', () => {
    expect(barcodeMatchesProduct('abc-1', { sku: 'ABC-1', barcode: null })).toBe(true)
    expect(barcodeMatchesProduct(' 999 ', { sku: 'ABC-1', barcode: '999' })).toBe(true)
    expect(barcodeMatchesProduct('nope', { sku: 'ABC-1', barcode: '999' })).toBe(false)
    expect(barcodeMatchesProduct('690123', { sku: '123', barcode: null })).toBe(false)
  })

  it('parses and formats work dates', () => {
    const d = parseWorkDate('2026-07-30')
    expect(d).not.toBeNull()
    expect(formatWorkDate(d)).toBe('2026-07-30')
    const dt = parseWorkDate('2026-08-04T10:00')
    expect(formatWorkDate(dt)).toBe('2026-08-04 10:00')
    expect(parseWorkDate('bad')).toBeNull()
  })

  it('resolves cargo type from outbound context', () => {
    expect(resolveCargoType({ outboundType: 'takealot', destType: 'local' })).toBe('takealot_inbound')
    expect(resolveCargoType({ destType: 'fba', needsRelabel: true })).toBe('relabel_outbound')
    expect(cargoTypeLabel('dropship_sku')).toBe('一件代发SKU')
  })
})
