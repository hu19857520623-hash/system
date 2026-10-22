import { describe, expect, it, vi } from 'vitest'
import { readWarehouseAttempts, saveWarehouseAttempt, clearWarehouseAttempt, runWarehouseAttempt, recoverWarehouseAttemptFailure, type WarehouseAttempt } from './warehouseOperation'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
const attempt = (id = 1): WarehouseAttempt => ({ kind: 'qc-submit', inboundId: id, inboundNo: `RV-${id}`, warehouseCode: 'WMS-JHB-01', payload: { clientRequestId: `key-${id}`, expectedVersion: 'a'.repeat(64), items: [{ id: 10, sku: 'A', actualQty: 2, qcStatus: 'pass' }] }, snapshot: { order: { id, status: 'receiving' } } })

describe('仓库操作中断后的原请求恢复', () => {
  it('重新读取保留原内容，且按登录人员隔离', () => {
    const local = storage(), original = attempt()
    saveWarehouseAttempt(local, 1, original)
    original.payload.items[0].actualQty = 9
    expect(readWarehouseAttempts(local, 1)[0].payload.items[0].actualQty).toBe(2)
    expect(readWarehouseAttempts(local, 2)).toEqual([])
  })
  it('原单未核实时拒绝替换请求、数量和操作类型，其他单据仍可保存', () => {
    const local = storage(), original = attempt()
    saveWarehouseAttempt(local, 1, original)
    expect(() => saveWarehouseAttempt(local, 1, { ...attempt(), payload: { ...original.payload, clientRequestId: 'another' } })).toThrow('原操作')
    expect(() => saveWarehouseAttempt(local, 1, { ...attempt(), payload: { ...original.payload, items: [] } })).toThrow('原操作')
    expect(() => saveWarehouseAttempt(local, 1, { ...attempt(), kind: 'measure' })).toThrow('原操作')
    saveWarehouseAttempt(local, 1, attempt(2))
    expect(readWarehouseAttempts(local, 1)).toHaveLength(2)
  })
  it('只能清除对应的单据和原标识，不能清掉后来操作', () => {
    const local = storage(), original = attempt()
    saveWarehouseAttempt(local, 1, original); saveWarehouseAttempt(local, 1, attempt(2))
    clearWarehouseAttempt(local, 1, { ...original, payload: { ...original.payload, clientRequestId: 'old' } })
    expect(readWarehouseAttempts(local, 1)).toHaveLength(2)
    clearWarehouseAttempt(local, 1, original)
    expect(readWarehouseAttempts(local, 1).map(row => row.inboundId)).toEqual([2])
  })
  it('损坏或不可写的本机存储给出中文恢复说明，不冒险发送新操作', () => {
    const local = storage(); local.setItem('erp:warehouse-operations:1', '{broken')
    expect(() => readWarehouseAttempts(local, 1)).toThrow('无法读取')
    expect(() => saveWarehouseAttempt({ ...storage(), setItem: () => { throw new Error('QuotaExceeded') } }, 1, attempt())).toThrow('本次尚未提交')
    expect(() => readWarehouseAttempts(storage(), 0)).toThrow(/[\u4e00-\u9fa5]/)
  })
  it('响应丢失后恢复发送完全相同的清点请求', async () => {
    const local = storage(), original = attempt(), api = { qc: vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ duplicate: true }) }
    saveWarehouseAttempt(local, 1, original)
    await expect(runWarehouseAttempt(api, original)).rejects.toThrow()
    const restored = readWarehouseAttempts(local, 1)[0]
    await expect(runWarehouseAttempt(api, restored)).resolves.toEqual({ duplicate: true })
    expect(api.qc.mock.calls[0]).toEqual(api.qc.mock.calls[1])
  })
  it('箱数原请求可在单据已进入下一状态后核对，不能重新确认到仓', async () => {
    const original = { ...attempt(), kind: 'carton-count' as const, payload: { clientRequestId: 'count-key', receivedCartonCount: 1 } }
    const api = { detail: vi.fn().mockResolvedValue({ status: 'pending_putaway', cartons: [] }), arrivalScan: vi.fn(), recordReceivedCartonCount: vi.fn().mockResolvedValue({ duplicate: true }) }
    await runWarehouseAttempt(api, original)
    expect(api.recordReceivedCartonCount).toHaveBeenCalledWith(1, { receivedCartonCount: 1, differenceReason: undefined, clientRequestId: 'count-key' })
    expect(api.arrivalScan).not.toHaveBeenCalled()
  })
  it('合并清点测量只发一个请求，独立测量仍走测量接口', async () => {
    const api = { qcAndMeasure: vi.fn().mockResolvedValue({}), measureDimensions: vi.fn().mockResolvedValue({}), qc: vi.fn() }
    await runWarehouseAttempt(api, { ...attempt(), kind: 'qc-measure-submit' })
    expect(api.qcAndMeasure).toHaveBeenCalledOnce(); expect(api.qc).not.toHaveBeenCalled(); expect(api.measureDimensions).not.toHaveBeenCalled()
    await runWarehouseAttempt(api, { ...attempt(), kind: 'measure' }); expect(api.measureDimensions).toHaveBeenCalledOnce()
  })
  it('上架的库位、件数和版本在刷新与响应丢失后完整保留，重试发送同一请求', async () => {
    const local = storage(), original: WarehouseAttempt = { ...attempt(), kind: 'putaway', payload: { clientRequestId: 'putaway-key', expectedVersion: 'a'.repeat(64), items: [{ inboundItemId: 10, lines: [{ locationCode: 'A-01', qty: 1 }] }] } }
    const api = { putaway: vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ duplicate: true, remainingQty: 1 }) }
    saveWarehouseAttempt(local, 1, original)
    await expect(runWarehouseAttempt(api, original)).rejects.toThrow()
    await expect(runWarehouseAttempt(api, readWarehouseAttempts(local, 1)[0])).resolves.toEqual({ duplicate: true, remainingQty: 1 })
    expect(api.putaway.mock.calls[0]).toEqual(api.putaway.mock.calls[1])
    expect(readWarehouseAttempts(local, 1)[0].payload.items[0].lines[0]).toEqual({ locationCode: 'A-01', qty: 1 })
  })
  it.each([['resolve-exception', 'resolveException'], ['reopen-count', 'reopenCount'], ['close-zero', 'closeZero'], ['reduce-qc', 'reduceQc'], ['reduce-carton', 'reduceCarton'], ['reduce-putaway', 'reducePutaway']] as const)('恢复%s保留原原因、版本与减少数量', async (kind, endpoint) => {
    const local = storage(), original: WarehouseAttempt = { ...attempt(), kind, payload: { clientRequestId: 'control-key', expectedVersion: 'b'.repeat(64), reason: '核对实际差异', quantity: 1, expectedCurrent: 2, inboundItemId: 10 } }
    saveWarehouseAttempt(local, 1, original)
    const api = { [endpoint]: vi.fn().mockResolvedValue({ duplicate: true }) }
    await runWarehouseAttempt(api, readWarehouseAttempts(local, 1)[0])
    expect(api[endpoint]).toHaveBeenCalledWith(1, original.payload)
  })
  it.each([401, 403, 408, 429, 500, 502, undefined])('响应丢失后的%s不能丢弃原操作，恢复后重试原请求', async status => {
    const local = storage(), original = attempt(), error = Object.assign(new Error('Forbidden'), { status })
    const api = { qc: vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(error).mockResolvedValueOnce({ duplicate: true }) }
    saveWarehouseAttempt(local, 1, original)
    for (let step = 0; step < 2; step++) {
      try { await runWarehouseAttempt(api, readWarehouseAttempts(local, 1)[0]) }
      catch (failure) { expect(recoverWarehouseAttemptFailure(local, 1, original, failure)).toMatchObject({ retained: true, message: expect.stringMatching(/[\u4e00-\u9fa5]/) }) }
      expect(readWarehouseAttempts(local, 1)).toEqual([original])
    }
    await expect(runWarehouseAttempt(api, readWarehouseAttempts(local, 1)[0])).resolves.toEqual({ duplicate: true })
    expect(api.qc.mock.calls).toEqual([[1, original.payload], [1, original.payload], [1, original.payload]])
    clearWarehouseAttempt(local, 1, original); expect(readWarehouseAttempts(local, 1)).toEqual([])
  })
  it.each([400, 404, 409, 422])('明确拒绝%s后丢弃失效表单并指向最新单据', status => {
    const local = storage(), original = attempt(); saveWarehouseAttempt(local, 1, original)
    expect(recoverWarehouseAttemptFailure(local, 1, original, { status, message: '单据已变更' })).toMatchObject({ retained: false, message: expect.stringContaining('重新读取') })
    expect(readWarehouseAttempts(local, 1)).toEqual([])
  })
  it('清除失败时保留原请求并显示恢复说明，不能把存储异常裸露给用户', () => {
    const local = storage(), original = attempt(); saveWarehouseAttempt(local, 1, original)
    const result = recoverWarehouseAttemptFailure({ ...local, removeItem: () => { throw new Error('SecurityError') } }, 1, original, { status: 409, message: '单据已变更' })
    expect(result).toMatchObject({ retained: true, message: expect.stringContaining('核对信息未能清除') })
    expect(result.message).not.toContain('SecurityError');expect(readWarehouseAttempts(local, 1)).toEqual([original])
  })
})
