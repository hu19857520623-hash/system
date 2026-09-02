import {
  canonicalizeFollowSales,
  followSalesMatchesUser,
  followSalesMatchTokens,
  formatFollowSalesLabel,
  parseFollowSalesFromRemark,
  resolveAssigneeIdByFollowSales,
  resolveFollowSales,
} from './leads-follow-sales.util'

describe('formatFollowSalesLabel', () => {
  it('joins real name and username', () => {
    expect(formatFollowSalesLabel({ realName: '尚彩云', username: 'caiyun' })).toBe('尚彩云(caiyun)')
  })

  it('uses a single value when they match', () => {
    expect(formatFollowSalesLabel({ realName: 'Ronan', username: 'Ronan' })).toBe('Ronan')
  })
})

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

describe('canonicalizeFollowSales', () => {
  const users = [
    { username: 'sky', realName: 'ohhh bys' },
    { username: 'caiyun', realName: '尚彩云' },
  ]

  it('merges ohhh bys aliases onto the system account label', () => {
    expect(canonicalizeFollowSales('ohhh bys', users)).toBe('ohhh bys(sky)')
    expect(canonicalizeFollowSales('ohhh bys(sky)', users)).toBe('ohhh bys(sky)')
    expect(canonicalizeFollowSales('ohhh bys@微信', users)).toBe('ohhh bys(sky)')
  })

  it('merges 陈琪珍 nicknames onto the system account label', () => {
    const withChen = [...users, { username: 'chenqizhen', realName: '陈琪珍' }]
    expect(canonicalizeFollowSales('陈琪珍(kiki)', withChen)).toBe('陈琪珍(chenqizhen)')
    expect(canonicalizeFollowSales('陈琪珍(chenqizhen)', withChen)).toBe('陈琪珍(chenqizhen)')
  })

  it('merges Ronan(Ronan) onto the system account label', () => {
    const withRonan = [...users, { username: 'ronan', realName: '邱张源' }]
    expect(canonicalizeFollowSales('Ronan(Ronan)', withRonan)).toBe('邱张源(ronan)')
    expect(canonicalizeFollowSales('ronan', withRonan)).toBe('邱张源(ronan)')
  })

  it('keeps combined sales names', () => {
    expect(canonicalizeFollowSales('尚彩云, Ronan(Ronan)', users)).toBe('尚彩云, Ronan(Ronan)')
  })
})

describe('resolveAssigneeIdByFollowSales', () => {
  const assignees = [
    { id: 19, username: 'chenqizhen', realName: '陈琪珍' },
    { id: 22, username: 'caiyun', realName: '尚彩云' },
  ]

  it('resolves 陈琪珍(kiki) to chenqizhen', () => {
    expect(resolveAssigneeIdByFollowSales('陈琪珍(kiki)', assignees)).toBe(19n)
  })

  it('returns null when no assignee matches', () => {
    expect(resolveAssigneeIdByFollowSales('ohhh bys@微信', assignees)).toBeNull()
  })
})
