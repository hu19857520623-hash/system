import {
  followSalesMatchesUser,
  followSalesMatchTokens,
  parseFollowSalesFromRemark,
  resolveFollowSales,
} from './leads-follow-sales.util'

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

describe('followSalesMatchTokens', () => {
  it('keeps real name and username', () => {
    expect(followSalesMatchTokens({ username: 'ronan', realName: '邱张源' })).toEqual(['邱张源', 'ronan'])
  })

  it('skips short ascii usernames', () => {
    expect(followSalesMatchTokens({ username: 'cs', realName: '陈琪珍' })).toEqual(['陈琪珍'])
  })
})

describe('followSalesMatchesUser', () => {
  const ronan = { username: 'ronan', realName: '邱张源' }

  it('matches Ronan(Ronan)', () => {
    expect(followSalesMatchesUser('Ronan(Ronan)', ronan)).toBe(true)
  })

  it('matches combined 尚彩云, Ronan(Ronan)', () => {
    expect(followSalesMatchesUser('尚彩云, Ronan(Ronan)', ronan)).toBe(true)
  })

  it('does not match another salesperson', () => {
    expect(followSalesMatchesUser('陈琪珍(kiki)', ronan)).toBe(false)
    expect(followSalesMatchesUser('尚彩云', ronan)).toBe(false)
  })

  it('matches 陈琪珍(kiki) by real name', () => {
    expect(followSalesMatchesUser('陈琪珍(kiki)', { username: 'chenqizhen', realName: '陈琪珍' })).toBe(true)
  })
})
