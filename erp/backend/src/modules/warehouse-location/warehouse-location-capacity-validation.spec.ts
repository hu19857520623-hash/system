import { BadRequestException } from '@nestjs/common'
import { validLocationCapacity } from './warehouse-location.service'

describe('库位体积/承重上限录入校验', () => {
  it('空值清空、未传跳过、合法值放行', () => {
    expect(validLocationCapacity(undefined, '库位体积上限')).toBeUndefined()
    expect(validLocationCapacity(null, '库位体积上限')).toBeNull()
    expect(validLocationCapacity('', '库位体积上限')).toBeNull()
    expect(validLocationCapacity(0.01, '库位体积上限')).toBe(0.01)
    expect(validLocationCapacity('999999.99', '库位承重上限')).toBe(999999.99)
  })
  it.each([-5, 0, 1000000, 'abc'])('拒绝非法值 %p', v => {
    expect(() => validLocationCapacity(v, '库位体积上限')).toThrow(BadRequestException)
    expect(() => validLocationCapacity(v, '库位承重上限')).toThrow('库位承重上限须为大于 0 且不超过 999999.99 的数值')
  })
  it('报错为中文', () => {
    try {
      validLocationCapacity(-1, '库位体积上限')
      fail('should throw')
    } catch (e: any) {
      expect(/[\u4e00-\u9fff]/.test(e.message)).toBe(true)
    }
  })
})
