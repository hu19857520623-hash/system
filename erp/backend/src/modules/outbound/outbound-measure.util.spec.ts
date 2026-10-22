import { BadRequestException } from '@nestjs/common'
import { computeOutboundCartonMeasures, sumOutboundCartonTotals } from './outbound-measure.util'

describe('outbound review measurement validation', () => {
  const carton = { lengthCm: 30, widthCm: 20, heightCm: 20, grossWeightKg: 2 }

  it('rejects a missing carton without leaking an internal property access error', () => {
    expect(() => computeOutboundCartonMeasures([null as any])).toThrow(new BadRequestException('第 1 箱资料无效，请填写尺寸与毛重'))
  })

  it.each([0, -1, NaN, Infinity, 'invalid', undefined])('rejects invalid dimension %s as an actionable Chinese client error', value => {
    try {
      computeOutboundCartonMeasures([{ ...carton, lengthCm: value as number }])
      throw new Error('Expected validation rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).getStatus()).toBe(400)
      expect((error as Error).message).toMatch(/第 1 箱尺寸无效.*长、宽、高/)
    }
  })

  it.each([-1, NaN, Infinity, 'invalid', undefined])('rejects invalid weight %s rather than silently turning it into zero', value => {
    expect(() => computeOutboundCartonMeasures([{ ...carton, grossWeightKg: value as number }]))
      .toThrow(new BadRequestException('第 1 箱毛重无效，请填写不小于零的重量'))
  })

  it('identifies the second carton and rejects volume overflow or rounding to zero', () => {
    expect(() => computeOutboundCartonMeasures([carton, { ...carton, heightCm: 0 }])).toThrow(/第 2 箱/)
    expect(() => computeOutboundCartonMeasures([{ ...carton, lengthCm: Number.MAX_VALUE }])).toThrow(/体积无效/)
    expect(() => computeOutboundCartonMeasures([{ ...carton, lengthCm: 0.000000001 }])).toThrow(/体积无效/)
  })

  it('preserves valid decimal measurements, totals and the supported zero-weight value', () => {
    const rows = computeOutboundCartonMeasures([carton, { ...carton, grossWeightKg: 0, lengthCm: 30.5 }])
    expect(rows).toEqual([{ ...carton, cartonNo: 1, volumeCbm: 0.012 }, { ...carton, grossWeightKg: 0, lengthCm: 30.5, cartonNo: 2, volumeCbm: 0.0122 }])
    expect(sumOutboundCartonTotals(rows)).toEqual({ totalVolumeM3: 0.0242, totalWeightKg: 2 })
  })
})
