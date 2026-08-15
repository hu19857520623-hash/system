import { calculateOutboundActualFees, resolveFeeTemplateSnapshot } from './outbound-fee-calc.util'

describe('calculateOutboundActualFees', () => {
  const snapshot = resolveFeeTemplateSnapshot({
    handling: { perOrderBase: 8, perUnit: 1.2, perSkuLine: 2 },
    shipping: { mode: 'volume', ratePerCbm: 580, minCharge: 30 },
    shippingMethod: '卡派',
    destRegion: 'jhb',
  })

  it('calculates handling + volume shipping from measured totals', () => {
    const result = calculateOutboundActualFees({
      totalVolumeM3: 0.05,
      totalWeightKg: 12,
      totalQty: 10,
      skuLineCount: 2,
      snapshot,
    })
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].amount).toBe(8 + 1.2 * 10 + 2 * 2)
    expect(result.lines[1].amount).toBe(Math.max(30, 0.05 * 580))
    expect(result.total).toBe(result.lines[0].amount + result.lines[1].amount)
  })
})
