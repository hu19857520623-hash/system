export type TrendPoint = {
  date: string
  /** 中转仓收货单数 */
  receipts: number
  /** 实收件数合计 */
  receivedQty: number
  /** 残次件数合计 */
  damagedQty: number
}

export function dayRangeUtc(days: number, now = new Date()): { start: Date; end: Date; label: string }[] {
  const ranges: { start: Date; end: Date; label: string }[] = []
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const start = new Date(cursor)
    start.setUTCDate(start.getUTCDate() - offset)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)
    const label = `${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`
    ranges.push({ start, end, label })
  }

  return ranges
}

export function mergeTrendCounts(
  ranges: { label: string }[],
  receipts: number[],
  receivedQty: number[],
  damagedQty: number[],
): TrendPoint[] {
  return ranges.map((range, index) => ({
    date: range.label,
    receipts: receipts[index] ?? 0,
    receivedQty: receivedQty[index] ?? 0,
    damagedQty: damagedQty[index] ?? 0,
  }))
}
