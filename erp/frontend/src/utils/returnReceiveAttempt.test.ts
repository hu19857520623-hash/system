import { describe, expect, it } from 'vitest'
import { clearReturnReceiveAttempt, readReturnReceiveAttempt, saveReturnReceiveAttempt, type ReturnReceiveAttempt } from './returnReceiveAttempt'
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const attempt = (): ReturnReceiveAttempt => ({ action: 'receive', returnId: 7, returnNo: 'RT-1', payload: { clientRequestId: 'same-id', receivedQty: 2, receivedCartonCount: 1 }, uncertain: true, contentChanged: false })
describe('退件收货核对', () => {
  it('刷新后仍是同一次收货', () => {
    const port = storage()
    saveReturnReceiveAttempt(port, 1, attempt())
    expect(readReturnReceiveAttempt(port, 1)?.payload.clientRequestId).toBe('same-id')
    clearReturnReceiveAttempt(port, 1)
    expect(readReturnReceiveAttempt(port, 1)).toBeNull()
  })
  it('损坏的收货核对不能被当成没有原操作', () => {
    const port = storage()
    port.setItem('erp:return-receive:1', '{bad')
    expect(() => readReturnReceiveAttempt(port, 1)).toThrow('不要另起一次收货')
  })
})
