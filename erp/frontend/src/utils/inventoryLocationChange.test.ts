import { describe, expect, it } from 'vitest'
import { clearLocationAdjustAttempt, clearLocationBatchAttempt, clearLocationChangeAttempt, inventoryAuthRecovery, keepFailedBatchRows, readLocationAdjustAttempt, readLocationBatchAttempt, readLocationChangeAttempt, sameBatchRows, sameLocationAdjust, sameLocationChange, saveLocationAdjustAttempt, saveLocationBatchAttempt, saveLocationChangeAttempt, unappliedBatchRows, type LocationAdjustAttempt, type LocationChangeAttempt } from './inventoryLocationChange'

const attempt: LocationChangeAttempt = {
  clientRequestId: '97102566-c888-47eb-9eab-0ecdf141f941',
  customerCode: 'TKL9001',
  sku: 'TKL-A',
  warehouseCode: 'WMS-JHB-01',
  fromLocationCode: 'A-01',
  toLocationCode: 'B-02',
  qty: 1,
  remark: '移库',
}

function storage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  } as Storage
}

describe('库存变更原请求', () => {
  it('保存后刷新仍能读回同一操作标识和内容', () => {
    const port = storage()
    saveLocationChangeAttempt(port, 7, attempt)
    expect(readLocationChangeAttempt(port, 7)).toEqual(attempt)
    expect(sameLocationChange(attempt, { ...attempt })).toBe(true)
  })

  it('内容变化时不能当成同一次操作', () => {
    expect(sameLocationChange(attempt, { ...attempt, qty: 2 })).toBe(false)
    expect(sameLocationChange(attempt, { ...attempt, contentChanged: true })).toBe(true)
  })

  it('内容不同的标记会保留到刷新之后', () => {
    const port = storage()
    saveLocationChangeAttempt(port, 7, { ...attempt, contentChanged: true })
    expect(readLocationChangeAttempt(port, 7)?.contentChanged).toBe(true)
  })

  it('只清除当前操作标识', () => {
    const port = storage()
    saveLocationChangeAttempt(port, 7, attempt)
    clearLocationChangeAttempt(port, 7, 'other-id')
    expect(readLocationChangeAttempt(port, 7)?.clientRequestId).toBe(attempt.clientRequestId)
    clearLocationChangeAttempt(port, 7, attempt.clientRequestId)
    expect(readLocationChangeAttempt(port, 7)).toBeNull()
  })

  it('保存失败时不留下半条记录', () => {
    const port = storage()
    port.setItem = () => { throw new Error('quota') }
    expect(() => saveLocationChangeAttempt(port, 7, attempt)).toThrow('原库存变更未能保存，本次未提交')
    expect(port.getItem('inventory-location-change:7')).toBeNull()
  })

  it('批量结果只保留失败行，成功行按表格行号去掉', () => {
    expect(keepFailedBatchRows(['第一行', '第二行', '第三行'], [
      { line: 2, ok: true },
      { line: 3, ok: false },
      { line: 4, ok: true },
    ])).toEqual(['第二行'])
  })

  it('原批次按同一标识保存，结束回执只留下未入账行', () => {
    const port = storage()
    const batch = {
      clientRequestId: attempt.clientRequestId,
      defaultWarehouse: 'WMS-JHB-01',
      rows: [{ sku: 'A' }, { sku: 'B' }],
    }
    saveLocationBatchAttempt(port, 7, batch)
    expect(readLocationBatchAttempt(port, 7)).toEqual(batch)
    expect(sameBatchRows(batch.rows, [{ sku: 'A' }, { sku: 'B' }])).toBe(true)
    expect(sameBatchRows(batch.rows, [{ sku: 'B' }, { sku: 'A' }])).toBe(false)
    expect(unappliedBatchRows(batch.rows, [1])).toEqual([{ sku: 'B' }])
    clearLocationBatchAttempt(port, 7, batch.clientRequestId)
    expect(readLocationBatchAttempt(port, 7)).toBeNull()
  })

  it('原库位调整按同一标识保存，数量变化不算同一次', () => {
    const port = storage()
    const adjust: LocationAdjustAttempt = {
      clientRequestId: attempt.clientRequestId,
      locationId: 9,
      customerCode: 'TKL9001',
      sku: 'TKL-A',
      warehouseCode: 'WMS-JHB-01',
      locationCode: 'A-01',
      qty: 1,
    }
    saveLocationAdjustAttempt(port, 7, adjust)
    expect(readLocationAdjustAttempt(port, 7)).toEqual(adjust)
    expect(sameLocationAdjust(adjust, { ...adjust, qty: 2 })).toBe(false)
    clearLocationAdjustAttempt(port, 7, adjust.clientRequestId)
    expect(readLocationAdjustAttempt(port, 7)).toBeNull()
  })
  it('登录失效、岗位变化和请求频繁时保留原库存写入，不要求重新填写', () => {
    expect(inventoryAuthRecovery(401, '库位调整', '继续原调整')).toContain('重新登录')
    expect(inventoryAuthRecovery(403, '调拨', '继续原调拨')).toContain('原岗位权限')
    expect(inventoryAuthRecovery(429, '批量库存变更', '继续原批次')).toContain('不要重新填写')
    expect(inventoryAuthRecovery(400, '库位调整', '继续原调整')).toBeNull()
  })
})
