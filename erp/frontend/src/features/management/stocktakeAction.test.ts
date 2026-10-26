import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createStocktakeAction } from './stocktakeAction'
import { alertLevel, collectReport, inboundStatus, lineStatus, outboundStatus, planStatus } from './presentation'

const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(stop => stop()) })
function fixture(values = new Map<string, string>()) {
  const owner = ref('31'), storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const send = vi.fn().mockResolvedValue({ id: 3, status: 'counting' }), lookup = vi.fn().mockResolvedValue({ found: false }), applied = vi.fn()
  const controller = createStocktakeAction({ owner: () => owner.value, storage, send, lookup, applied, newId: () => 'audit-request-35' })
  stops.push(controller.stop)
  return { controller, values, owner, storage, send, lookup, applied }
}

describe('盘点提交恢复', () => {
  it.each(['cancel', 'replan'] as const)('%s结果未知时重开页面仍保留版本、原因，查回原结果不再发请求', async action => {
    const first = fixture(); first.send.mockRejectedValue(new TypeError('Failed to fetch'))
    await first.controller.start(action, { expectedVersion: 'st1-snapshot', reason: '库存变化' }, 3)
    first.controller.stop()
    const next = fixture(first.values)
    expect(next.controller.pending.value).toMatchObject({ action, planId: 3, payload: { expectedVersion: 'st1-snapshot', reason: '库存变化' } })
    next.lookup.mockResolvedValue({ found: true, action, plan: { id: action === 'replan' ? 5 : 3, status: action === 'replan' ? 'counting' : 'cancelled' } })
    await next.controller.reconcile()
    expect(next.send).not.toHaveBeenCalled(); expect(next.controller.pending.value).toBeNull()
    expect(next.applied).toHaveBeenCalledWith(action, expect.objectContaining({ id: action === 'replan' ? 5 : 3 }))
  })
  it('重复点击只发送一次，不把第一次数量自动作为复盘', async () => {
    const { controller, send, applied } = fixture()
    let resolve!: (value: unknown) => void
    send.mockReturnValue(new Promise(r => { resolve = r }))
    const original = controller.start('count', { lineId: 4, qty: 9, expectedStage: 'pending' }, 3)
    await controller.start('count', { lineId: 4, qty: 8, expectedStage: 'recount' }, 3)
    resolve({ id: 3 }); await original
    expect(send).toHaveBeenCalledTimes(1); expect(applied).toHaveBeenCalledTimes(1)
    expect(controller.pending.value).toBeNull()
  })
  it('断网后保留原请求内容，核对已提交结果不再重放提交', async () => {
    const { controller, send, lookup, applied, values } = fixture()
    send.mockRejectedValue(new TypeError('Failed to fetch'))
    const input = { lineId: 4, qty: 9, expectedStage: 'pending' }
    await controller.start('count', input, 3); input.qty = 1
    expect(controller.feedback.value).toContain('提交结果尚未确认')
    expect(controller.feedback.value).not.toContain('Failed to fetch')
    expect(controller.pending.value?.payload.qty).toBe(9); expect(values.size).toBe(1)
    lookup.mockResolvedValue({ found: true, action: 'count', plan: { id: 3, status: 'pending_approval' } })
    await controller.reconcile()
    expect(send).toHaveBeenCalledTimes(1); expect(applied).toHaveBeenCalledWith('count', expect.objectContaining({ id: 3 }))
    expect(controller.pending.value).toBeNull(); expect(values.size).toBe(0)
  })
  it('页面重开仍可恢复同一请求，重试沿用原始标识与内容', async () => {
    const first = fixture(); first.send.mockRejectedValue(new Error('服务处理失败'))
    await first.controller.start('create', { warehouseCode: 'WMS-AUDIT', mode: 'full' })
    first.controller.stop()
    const next = fixture(first.values)
    expect(next.controller.pending.value?.requestId).toBe('audit-request-35')
    await next.controller.reconcile()
    expect(next.controller.feedback.value).toContain('重试原提交')
    await next.controller.retry()
    expect(next.send).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'audit-request-35', payload: { warehouseCode: 'WMS-AUDIT', mode: 'full' } }))
  })
  it('存储失败时不发请求；已成功提交后的显示错误不冒充提交失败', async () => {
    const { controller, storage, send, applied } = fixture()
    const write = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new Error('QuotaExceeded') })
    await controller.start('approve', {}, 3)
    expect(send).not.toHaveBeenCalled(); expect(controller.feedback.value).toContain('本次尚未提交')
    write.mockRestore(); applied.mockImplementation(() => { throw new Error('Render failed') })
    await controller.start('approve', {}, 3)
    expect(controller.pending.value).toBeNull(); expect(controller.feedback.value).toContain('本次提交已完成')
    expect(controller.feedback.value).not.toContain('尚未确认')
  })
  it('业务拒绝保留可读反馈；核对失败保留待核对请求', async () => {
    const { controller, send, lookup } = fixture()
    send.mockRejectedValue(Object.assign(new Error('复盘必须由另一名作业员完成'), { status: 400 }))
    await controller.start('count', { lineId: 4, qty: 9, expectedStage: 'recount' }, 3)
    expect(controller.pending.value).toBeNull(); expect(controller.feedback.value).toContain('另一名作业员')
    send.mockRejectedValue(new Error('Gateway Timeout')); await controller.start('approve', {}, 3)
    lookup.mockRejectedValue(new TypeError('Failed to fetch')); await controller.reconcile()
    expect(controller.pending.value).not.toBeNull(); expect(controller.feedback.value).toContain('核对结果失败')
  })
  it('新账号不接管旧账号的提交，迟到结果不会覆盖当前页面', async () => {
    const { controller, send, owner, values, applied } = fixture()
    let resolve!: (value: unknown) => void
    send.mockReturnValue(new Promise(r => { resolve = r }))
    const pending = controller.start('approve', {}, 3)
    owner.value = '32'; await nextTick()
    expect(controller.pending.value).toBeNull()
    resolve({ id: 3 }); await pending
    expect(applied).not.toHaveBeenCalled(); expect(values.has('erp.stocktake.pending.31')).toBe(true)
  })
  it('未知结果后权限撤销，不能因重试403丢掉原提交的恢复记录', async () => {
    const { controller, send, values, lookup, applied } = fixture()
    send.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await controller.start('create', { mode: 'full' })
    send.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    await controller.retry()
    expect(controller.pending.value?.requestId).toBe('audit-request-35')
    expect(values.size).toBe(1)
    lookup.mockResolvedValue({ found: true, action: 'create', plan: { id: 3 } })
    await controller.reconcile()
    expect(applied).toHaveBeenCalledWith('create', { id: 3 })
    expect(controller.pending.value).toBeNull()
  })
})

describe('管理闭环状态与完整报表', () => {
  it('页面和CSV可共享中文状态，未知内部值显示待核对', () => {
    expect([inboundStatus('completed'), outboundStatus('packed'), planStatus('pending_approval'), lineStatus('recount'), alertLevel('critical')]).toEqual(['已入库', '待发运', '待审批', '待交接复盘', '严重预警'])
    expect(inboundStatus('NEW_UNKNOWN')).toBe('待核对'); expect(alertLevel('future')).toBe('待核对')
  })
  it('相同筛选分多页收齐后才能生成导出内容', async () => {
    const load = vi.fn().mockResolvedValueOnce({ total: 3, items: [{ inboundNo: 'A' }, { inboundNo: 'B' }] }).mockResolvedValueOnce({ total: 3, items: [{ inboundNo: 'C' }] })
    expect(await collectReport(load, { warehouseCode: 'WMS-AUDIT', dateFrom: '2026-10-01' }, 'inboundNo')).toHaveLength(3)
    expect(load.mock.calls[1]?.[0]).toEqual({ warehouseCode: 'WMS-AUDIT', dateFrom: '2026-10-01', page: 2, pageSize: 5000 })
  })
  it.each(['total', 'duplicate', 'empty'] as const)('中途发生%s变化不生成不完整文件', async kind => {
    const load = vi.fn().mockResolvedValueOnce({ total: 3, items: [{ inboundNo: 'A' }] }).mockResolvedValueOnce({ total: kind === 'total' ? 2 : 3, items: kind === 'duplicate' ? [{ inboundNo: 'A' }] : [] })
    await expect(collectReport(load, {}, 'inboundNo')).rejects.toThrow(/变化|不完整/)
  })
})
