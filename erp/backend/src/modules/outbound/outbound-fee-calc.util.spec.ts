import { calculateOutboundActualFees, resolveFeeTemplateSnapshot } from './outbound-fee-calc.util'

describe('calculateOutboundActualFees', () => {
  const snapshot = resolveFeeTemplateSnapshot({
    handling: { perOrderBase: 8, perUnit: 1.2, perSkuLine: 2 },
    shipping: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 2.32, minCharge: 30 },
    shippingMethod: '卡派',
    destRegion: 'jhb',
  })

  it('calculates handling + billing-weight shipping from measured totals', () => {
    const result = calculateOutboundActualFees({
      totalVolumeM3: 0.05,
      totalWeightKg: 12,
      totalQty: 10,
      skuLineCount: 2,
      snapshot,
    })
    const billKg = Math.max(12, (0.05 * 1_000_000) / 4000)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].amount).toBe(8 + 1.2 * 10 + 2 * 2)
    expect(result.lines[1].amount).toBe(Math.max(30, billKg * 2.32))
    expect(result.total).toBe(result.lines[0].amount + result.lines[1].amount)
  })

  it.each([['卡派', 60, 120], ['快递', 60, 120], ['卡派', 22.1, 82.52]])(
    'uses the larger measured weight for %s', (shippingMethod, totalWeightKg, expected) => {
      const result = calculateOutboundActualFees({ totalVolumeM3: 0.1650326, totalWeightKg,
        totalQty: 1, skuLineCount: 1, snapshot: { ...snapshot, shippingMethod,
          shipping: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 2, minCharge: 4 } } })
      expect(result.lines[1].amount).toBe(expected)
      expect(result.lines[1].detail).toContain('取大计费')
    },
  )

  it('explains why the historical low rate was charged a minimum of 4', () => {
    const result = calculateOutboundActualFees({ totalVolumeM3: 0.1650326, totalWeightKg: 22.1,
      totalQty: 6, skuLineCount: 3, snapshot: { ...snapshot,
        shipping: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0.02, minCharge: 4 } } })
    expect(result.lines[1].amount).toBe(4)
    expect(result.lines[1].detail).toContain('¥0.83；最低收费 ¥4.00，应收 ¥4.00')
  })

  it('compares actual weight even for legacy volume snapshots', () => {
    const result = calculateOutboundActualFees({ totalVolumeM3: 0.1650326, totalWeightKg: 60,
      totalQty: 1, skuLineCount: 1, snapshot: { ...snapshot,
        shipping: { mode: 'volume', volumetricRatio: 4000, ratePerCbm: 500, minCharge: 0 } } })
    expect(result.lines[1].amount).toBe(120)
  })
})
