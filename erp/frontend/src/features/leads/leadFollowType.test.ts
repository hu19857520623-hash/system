import { describe, expect, it } from 'vitest'
import { mapLead } from '@/api/mappers'
import { leadFollowTypeLabel } from './leadFollowType'

describe('列表与详情跟进方式显示', () => {
  it.each([
    ['phone', '电话'], ['wechat', '微信'], ['wecom', '企微'],
    ['email', '邮件'], ['visit', '拜访'], ['other', '其他'],
    [null, '未填写'], ['', '未填写'], ['legacy', 'legacy'],
  ])('%s 在列表和详情使用相同标签 %s', (followType, label) => {
    const detail = { followUps: [{ followType }, { followType: 'other' }] }
    expect(mapLead(detail).latestFollowTypeLabel).toBe(label)
    expect(leadFollowTypeLabel(detail.followUps[0]!.followType)).toBe(label)
    expect(detail.followUps[0]!.followType).toBe(followType)
  })

  it('没有跟进记录时显示未填写', () => {
    for (const followUps of [undefined, null, []]) {
      expect(mapLead({ followUps }).latestFollowTypeLabel).toBe('未填写')
    }
  })

  it('重新获取数据后显示最新方式，不沿用上一条记录', () => {
    expect(mapLead({ followUps: [{ followType: 'wechat' }] }).latestFollowTypeLabel).toBe('微信')
    expect(mapLead({ followUps: [{ followType: 'wecom' }, { followType: 'wechat' }] }).latestFollowTypeLabel).toBe('企微')
  })
})
