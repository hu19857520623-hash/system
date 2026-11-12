import { BadRequestException } from '@nestjs/common'
import { assertProductMeasureInput } from './products.service'

describe('商品尺寸/重量/金额录入校验', () => {
  it('空值与合法值放行', () => {
    expect(() => assertProductMeasureInput({})).not.toThrow()
    expect(() => assertProductMeasureInput({ lengthCm: null, widthCm: '', heightCm: undefined, weightKg: null })).not.toThrow()
    expect(() => assertProductMeasureInput({ lengthCm: 0.01, widthCm: 999.99, heightCm: 30, weightKg: 0.001, costRmb: 0 })).not.toThrow()
  })
  it.each([-5, 0, 0.005, 1000])('拒绝非法长 %p', v => {
    expect(() => assertProductMeasureInput({ lengthCm: v })).toThrow(BadRequestException)
    expect(() => assertProductMeasureInput({ lengthCm: v })).toThrow('长须为 0.01～999.99 厘米之间的数值')
  })
  it.each([-0.5, 0, 1000])('拒绝非法宽/高 %p', v => {
    expect(() => assertProductMeasureInput({ widthCm: v })).toThrow('宽须为')
    expect(() => assertProductMeasureInput({ heightCm: v })).toThrow('高须为')
  })
  it.each([-1, 0, 1000])('拒绝非法重量 %p', v => {
    expect(() => assertProductMeasureInput({ weightKg: v })).toThrow('重量须为 0.001～999.999 千克之间的数值')
  })
  it('拒绝负成本与负费用', () => {
    expect(() => assertProductMeasureInput({ costRmb: -1 })).toThrow('采购成本须为不小于 0 的有效数值')
    expect(() => assertProductMeasureInput({ marketPrice: -0.01 })).toThrow('市场参考价须为不小于 0 的有效数值')
    expect(() => assertProductMeasureInput({ seaFreightPerUnit: -1 })).toThrow('海运费须为不小于 0 的有效数值')
    expect(() => assertProductMeasureInput({ domesticFeePerUnit: -1 })).toThrow('国内费用须为不小于 0 的有效数值')
    expect(() => assertProductMeasureInput({ costRmb: 'abc' })).toThrow('采购成本须为不小于 0 的有效数值')
  })
  it('报错全部为中文', () => {
    try {
      assertProductMeasureInput({ lengthCm: -5 })
      fail('should throw')
    } catch (e: any) {
      expect(/[\u4e00-\u9fff]/.test(e.message)).toBe(true)
    }
  })
})
