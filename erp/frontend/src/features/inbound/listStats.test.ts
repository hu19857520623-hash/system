import { describe, expect, it } from 'vitest'
import { inboundListStats } from './listStats'
const row = (status: string, cbm = '1.000') => ({ _raw: { status }, cbm })
describe('发运列表与统计范围', () => {
  it('在途单计入待收货，已完成和待上架体积不计入在途立方', () => {
    expect(inboundListStats([row('pending_receipt', '0.008'), row('completed', '50'), row('pending_putaway', '20')])).toEqual({ total: 3, pendingReceipt: 1, pendingPutaway: 1, completed: 1, cbm: '0.008' })
  })
  it('来源或关键词过滤后的同一批行决定全部统计', () => {
    const rows = [row('arrived', '2'), row('receiving', '3'), row('completed')]
    expect(inboundListStats(rows.slice(0, 1))).toMatchObject({ total: 1, pendingReceipt: 1, completed: 0, cbm: '2.000' })
  })
  it('作废单不计入有效数量或在途体积，未知体积不会变为无效数值', () => {
    expect(inboundListStats([row('cancelled', '100'), row('pending_receipt', '—')])).toMatchObject({ total: 1, pendingReceipt: 1, cbm: '—' })
  })
})
