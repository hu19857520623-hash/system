import { describe, expect, it } from 'vitest'
import { clearReceiptAttempt, readReceiptAttempts, saveReceiptAttempt, type ReceiptAttempt } from './logisticsReceiptAttempt'

function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const attempt = (poId = 1): ReceiptAttempt => ({ payload: { poId, clientRequestId: 'original-id', items: [{ actualQty: 1 }] }, target: { id: poId, poNo: 'PO-TEST' }, lines: [{ actualQty: 1 }] })

describe('收货待核对操作跨刷新恢复', () => {
  it('保存独立快照，修改当前表单不改变重试的原数量与标识', () => {
    const port = storage(), original = attempt(); saveReceiptAttempt(port, 1, original)
    original.payload.items[0].actualQty = 9
    const restored = readReceiptAttempts(port, 1)[0]
    expect(restored.payload.clientRequestId).toBe('original-id'); expect(restored.payload.items[0].actualQty).toBe(1)
  })
  it('核对成功只移除本单，不清除其他用户或其他采购单的未知操作', () => {
    const port = storage(); saveReceiptAttempt(port, 1, attempt()); saveReceiptAttempt(port, 1, attempt(2)); saveReceiptAttempt(port, 2, attempt())
    clearReceiptAttempt(port, 1, 1)
    expect(readReceiptAttempts(port, 1).map(row => row.payload.poId)).toEqual([2]); expect(readReceiptAttempts(port, 2)).toHaveLength(1)
  })
  it('存储失败阻止提交前保存，以中文说明本次尚未提交', () => {
    const port = storage(); port.setItem = () => { throw new Error('QuotaExceededError') }
    expect(() => saveReceiptAttempt(port, 1, attempt())).toThrow('本次尚未提交')
  })
  it('损坏的历史核对信息不能静默丢弃而重新建单', () => {
    const port = storage(); port.setItem('erp:logistics-receipt-attempts:1', '{bad')
    expect(() => readReceiptAttempts(port, 1)).toThrow('核对信息无法读取')
    expect(() => saveReceiptAttempt(port, 1, attempt())).toThrow('核对信息无法读取')
  })
})
