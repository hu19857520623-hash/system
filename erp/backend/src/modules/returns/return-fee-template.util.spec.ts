import { computeCartonMeasures, sumCartonTotals } from './return-measure.util'
import { buildMeasurePhaseFeeLines, buildFeePreviewContext, defaultMeasureFeeRules } from './return-fee-template.util'

describe('return warehouse fee templates', () => {
  const cartons = [{ lengthCm: 40, widthCm: 30, heightCm: 20, grossWeightKg: 2 }]

  function linesForWarehouse(warehouse: string) {
    const computed = computeCartonMeasures(cartons)
    const totals = sumCartonTotals(computed)
    const ctx = buildFeePreviewContext({
      cartonCount: 1,
      totalVolumeCbm: totals.totalVolumeCbm,
      totalChargeableWeightKg: totals.totalChargeableWeightKg,
    })
    return buildMeasurePhaseFeeLines(ctx, defaultMeasureFeeRules(warehouse))
  }

  it('uses template rules: JHB3 4 RMB/kg', () => {
    const lines = linesForWarehouse('JHB3')
    expect(lines[0]?.amount).toBe(19.2)
    expect(lines[0]?.unitPrice).toBe(4)
  })

  it('uses template rules: CPT2 6 RMB/kg with 8kg min', () => {
    const lines = linesForWarehouse('CPT2')
    expect(lines[0]?.amount).toBe(48)
    expect(lines[0]?.unitPrice).toBe(6)
  })

  it('uses template rules: DBN 7 RMB/kg with 8kg min', () => {
    const lines = linesForWarehouse('DBN')
    expect(lines[0]?.amount).toBe(56)
    expect(lines[0]?.unitPrice).toBe(7)
  })

  it('volumetric weight uses L×W×H÷5000', () => {
    const [c] = computeCartonMeasures([{ lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 1 }])
    expect(c?.volumetricWeightKg).toBe(12)
    expect(c?.chargeableWeightKg).toBe(12)
  })
})
