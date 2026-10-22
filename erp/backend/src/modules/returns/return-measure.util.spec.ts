import { computeCartonMeasures, sumCartonTotals } from './return-measure.util'
describe('return measurement validation', () => {
  const carton = { lengthCm: 30, widthCm: 20, heightCm: 20, grossWeightKg: 2 }
  it.each([0, -1, NaN, Infinity, 'invalid'])('rejects invalid dimension %s before fee computation', value => {
    expect(() => computeCartonMeasures([{ ...carton, widthCm: value as number }])).toThrow(/第 1 箱尺寸无效/)
  })
  it.each([-1, NaN, Infinity, 'invalid'])('rejects invalid weight %s rather than silently using zero', value => {
    expect(() => computeCartonMeasures([{ ...carton, grossWeightKg: value as number }])).toThrow(/第 1 箱毛重无效/)
  })
  it('handles missing cartons and nonrepresentable volume with Chinese validation', () => {
    expect(() => computeCartonMeasures([null as any])).toThrow(/箱资料无效/)
    expect(() => computeCartonMeasures([{ ...carton, widthCm: Number.MAX_VALUE }])).toThrow(/箱体积无效/)
  })
  it('preserves measured volume, weight and chargeable weight totals', () => {
    const result = computeCartonMeasures([carton])
    expect(result[0]).toMatchObject({ volumeCbm: 0.012, grossWeightKg: 2 })
    expect(sumCartonTotals(result)).toMatchObject({ totalVolumeCbm: 0.012, totalGrossWeightKg: 2 })
  })
})
