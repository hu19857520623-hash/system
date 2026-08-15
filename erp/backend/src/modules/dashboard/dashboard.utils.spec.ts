import { dayRangeUtc, mergeTrendCounts } from './dashboard.utils'

describe('dashboard.utils', () => {
  it('builds consecutive UTC day ranges with labels', () => {
    const ranges = dayRangeUtc(3, new Date('2026-07-27T15:30:00.000Z'))
    expect(ranges).toHaveLength(3)
    expect(ranges.map((r) => r.label)).toEqual(['07-25', '07-26', '07-27'])
    expect(ranges[0]?.end.getTime()).toBe(ranges[1]?.start.getTime())
  })

  it('merges parallel count arrays into trend points', () => {
    const points = mergeTrendCounts(
      [{ label: '07-25' }, { label: '07-26' }],
      [2, 4],
      [10, 0],
      [0, 3],
    )
    expect(points).toEqual([
      { date: '07-25', receipts: 2, receivedQty: 10, damagedQty: 0 },
      { date: '07-26', receipts: 4, receivedQty: 0, damagedQty: 3 },
    ])
  })
})
