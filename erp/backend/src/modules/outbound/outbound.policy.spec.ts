import { summarizeRemark, summarizeSkus, barcodeMatchesProduct, parseWorkDate, formatWorkDate, resolveCargoType, cargoTypeLabel, formatPickerStationLabel, normalizeWorkstation, outboundPickBlockedReason, pdaPickerMismatchReason, pickScanNextQty, canApplyDeliveryOutcome, parseDeliveryOutcome } from './outbound.policy'

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

  it('formats workstation labels and pick scan increments', () => {
    expect(normalizeWorkstation('  工位A  ')).toBe('工位A')
    expect(normalizeWorkstation('')).toBeNull()
    expect(formatPickerStationLabel('张仓管', '工位A')).toBe('工位A · 张仓管')
    expect(formatPickerStationLabel('张仓管', '')).toBe('张仓管')
    expect(pickScanNextQty(1, 4, 'piece')).toBe(2)
    expect(pickScanNextQty(1, 4, 'carton')).toBe(4)
    expect(pickScanNextQty(4, 4, 'piece')).toBe(4)
  })

  it('blocks unassigned and other-picker PDA scans', () => {
    expect(outboundPickBlockedReason({ status: 'pending_pick', pickerId: null })).toBe('请先分配拣货员后再完成拣货')
    expect(outboundPickBlockedReason({ status: 'picking', pickerId: 8 })).toBeNull()
    expect(pdaPickerMismatchReason(8, 8)).toBeNull()
    expect(pdaPickerMismatchReason(8, 99)).toBe('该出库单已分配给其他拣货员，不能扫描')
    expect(pdaPickerMismatchReason(null, 8)).toBe('请先分配拣货员后再完成拣货')
  })

  it('allows post-ship delivery outcomes', () => {
    expect(parseDeliveryOutcome(undefined)).toBe('delivered')
    expect(parseDeliveryOutcome('partial_delivered')).toBe('partial_delivered')
    expect(parseDeliveryOutcome('nope')).toBeNull()
    expect(canApplyDeliveryOutcome('shipped', 'delivered')).toBe(true)
    expect(canApplyDeliveryOutcome('shipped', 'partial_delivered')).toBe(true)
    expect(canApplyDeliveryOutcome('shipped', 'delivery_failed')).toBe(true)
    expect(canApplyDeliveryOutcome('partial_delivered', 'delivered')).toBe(true)
    expect(canApplyDeliveryOutcome('partial_delivered', 'partial_delivered')).toBe(false)
    expect(canApplyDeliveryOutcome('delivery_failed', 'delivered')).toBe(true)
    expect(canApplyDeliveryOutcome('packed', 'delivered')).toBe(false)
  })
})
