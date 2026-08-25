import { describe, expect, it } from 'vitest'
import { buildMilestones, buildTimelineEntries, fmtStepDate } from './trackingTimeline'

describe('trackingTimeline', () => {
  it('maps nodes to milestones with dates', () => {
    const nodes = [
      { statusName: '已订舱', eventTime: '2026-06-25' },
      { statusName: '已离港', description: '船公司已开船', eventTime: '2026-07-05' },
      { statusName: '已到港', description: 'DURBAN', eventTime: '2026-07-27' },
    ]
    const milestones = buildMilestones(nodes)
    expect(milestones[0]?.label).toBe('已订舱')
    expect(milestones[0]?.date).toBe('2026-06-25')
    expect(milestones[0]?.reached).toBe(true)
    expect(milestones[2]?.reached).toBe(true)
    expect(milestones[1]?.reached).toBe(false)
  })

  it('builds timeline with order info first', () => {
    const entries = buildTimelineEntries(
      [{ statusName: '已入仓/签入', description: '货物到达佛山仓', eventTime: '2026-06-25' }],
      { jobNum: 'SEAE1', trackingId: 'EZ1', expressTracking: 'TKL-1' },
    )
    expect(entries[0]?.title).toBe('订单信息')
    expect(entries[0]?.description).toContain('Job#: SEAE1')
    expect(entries[1]?.title).toBe('已入仓/签入')
  })

  it('formats step dates', () => {
    expect(fmtStepDate('2026年6月25日')).toBe('2026-06-25')
  })
})
