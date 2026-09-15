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
})
