import { parseFollowSalesFromRemark, resolveFollowSales } from './leads-follow-sales.util'

describe('parseFollowSalesFromRemark', () => {
  it('prefers 再对接 over 对接', () => {
    expect(parseFollowSalesFromRemark('对接:陈琪珍 | 再对接:林心仪')).toBe('林心仪')
  })

  it('falls back to 对接', () => {
    expect(parseFollowSalesFromRemark('留资:主动加 | 对接:ohhh bys@微信')).toBe('ohhh bys@微信')
  })

  it('returns empty when neither exists', () => {
    expect(parseFollowSalesFromRemark('留资:主动留资 | 获客:陈')).toBe('')
  })
})

describe('resolveFollowSales', () => {
  it('uses stored field first', () => {
    expect(resolveFollowSales('尚彩云', '再对接:林心仪')).toBe('尚彩云')
  })

  it('falls back to remark', () => {
    expect(resolveFollowSales('', '再对接:张凯琳')).toBe('张凯琳')
  })
})
