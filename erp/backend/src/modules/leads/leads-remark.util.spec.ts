import { stripLeadRemarkImportPrefix } from './leads-remark.util'

describe('stripLeadRemarkImportPrefix', () => {
  it('strips 留资/获客/对接 prefix for Ronan leads', () => {
    expect(
      stripLeadRemarkImportPrefix(
        '留资:主动留资 | 获客:陈 | 对接:Ronan(Ronan) | 备注:添加后问瑞加的不吱声了',
      ),
    ).toBe('添加后问瑞加的不吱声了')
  })

  it('strips extended import segments', () => {
    expect(
      stripLeadRemarkImportPrefix(
        '留资:主动留资 | 前端:了解南非跨境 | 获客:陈 | 再对接:林心仪 | 销售情况:已加微信 | 备注:没回复',
      ),
    ).toBe('没回复')
  })

  it('returns plain remark unchanged', () => {
    expect(stripLeadRemarkImportPrefix('客户考虑中')).toBe('客户考虑中')
  })

  it('returns empty for prefix-only remark', () => {
    expect(stripLeadRemarkImportPrefix('留资:主动留资 | 获客:陈 | 对接:Ronan(Ronan)')).toBe('')
  })
})
