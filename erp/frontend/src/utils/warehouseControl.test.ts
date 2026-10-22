import { describe, expect, it } from 'vitest'
import { warehouseControlOptions, warehouseControlLimit, warehouseControlCurrent } from './warehouseControl'
const can = (...permissions: string[]) => (permission: string) => permissions.includes(permission)
const fixture = (status = 'pending_putaway', actualQty: number | null = 0) => ({ id: 1, status, receivedCartonCount: 2, items: [{ id: 1, actualQty, putawayQty: 0 }], putawayItems: [] as any[] })
describe('仓库数量更正的角色与状态入口', () => {
  it('实收不明确不能当作全零，已有上架不能重新清点', () => {
    expect(warehouseControlOptions(fixture('pending_putaway', null), can('inbound.confirm_diff'))).not.toContain('close-zero')
    const order = fixture(); order.items[0].putawayQty = 1
    expect(warehouseControlOptions(order, can('inbound.qc', 'inbound.confirm_diff'))).not.toContain('reopen-count')
  })
  it('零收货结束保持主管权限；异常放行匹配声明的允许岗位', () => {
    expect(warehouseControlOptions(fixture(), can('inbound.qc'))).not.toContain('close-zero')
    expect(warehouseControlOptions(fixture(), can('inbound.confirm_diff'))).toContain('close-zero')
    expect(warehouseControlOptions(fixture('exception'), can('inbound.putaway'))).toContain('resolve-exception')
  })
  it('已完结普通单不再提供撤回上架，明确零收货可重新更正', () => {
    expect(warehouseControlOptions(fixture('completed', 1), can('inbound.putaway', 'inbound.qc'))).toEqual([])
    expect(warehouseControlOptions(fixture('completed', 0), can('inbound.qc'))).toEqual(['reopen-count'])
  })
  it('减少清点和箱数分别按权限呈现，OMS未同步只读单没有作业动作', () => {
    expect(warehouseControlOptions(fixture('receiving', 2), can('inbound.receive'))).toEqual(['reduce-carton'])
    expect(warehouseControlOptions(fixture('receiving', 2), can('inbound.qc'))).toEqual(['reduce-qc'])
    expect(warehouseControlOptions({ ...fixture('receiving', 2), readOnly: true }, () => true)).toEqual([])
  })
  it('撤回上架最多最近一笔正数量，不把历史零记录当作最新可撤回数量', () => {
    const order = fixture('pending_putaway', 5); order.items[0].putawayQty = 4
    order.putawayItems = [{ id: 1, inboundItemId: 1, qty: 2 }, { id: 2, inboundItemId: 1, qty: 1 }, { id: 3, inboundItemId: 1, qty: 0 }]
    expect(warehouseControlCurrent(order, 'reduce-putaway', 1)).toBe(4)
    expect(warehouseControlLimit(order, 'reduce-putaway', 1)).toBe(1)
    expect(warehouseControlOptions(order, can('inbound.putaway'))).toEqual(['reduce-putaway'])
  })
})
