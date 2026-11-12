import { describe, expect, it } from 'vitest'
import { clearReturnProcessAttempt, readReturnProcessAttempt, saveReturnProcessAttempt, type ReturnProcessAttempt } from './returnProcessAttempt'
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const attempt = (): ReturnProcessAttempt => ({
  returnId: 7, returnNo: 'RT-1',
  payload: { clientRequestId: 'process-id', processResult: 'restock', stockLines: [{ sku: 'A', qty: 1, locationCode: 'A-01' }] },
  uncertain: true, contentChanged: false,
})
describe('退件处理核对', () => {
  it('刷新后仍是同一次上架', () => {
    const port = storage()
    saveReturnProcessAttempt(port, 1, attempt())
    expect(readReturnProcessAttempt(port, 1)?.payload.clientRequestId).toBe('process-id')
    clearReturnProcessAttempt(port, 1)
    expect(readReturnProcessAttempt(port, 1)).toBeNull()
  })
  it('损坏的处理核对不能被当成没有原操作', () => {
    const port = storage()
    port.setItem('erp:return-process:1', '{bad')
    expect(() => readReturnProcessAttempt(port, 1)).toThrow('不要另起一次上架')
  })
})
