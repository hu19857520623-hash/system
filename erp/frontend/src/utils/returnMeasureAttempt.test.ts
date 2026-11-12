import { describe, expect, it } from 'vitest'
import { clearReturnMeasureAttempt, readReturnMeasureAttempt, saveReturnMeasureAttempt, type ReturnMeasureAttempt } from './returnMeasureAttempt'
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const attempt = (): ReturnMeasureAttempt => ({
  returnId: 7, returnNo: 'RT-1',
  measurePayload: { clientRequestId: 'measure-id', cartons: [{ lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 1 }] },
  feePayload: { clientRequestId: 'fee-id' }, feeSent: true, uncertain: true, contentChanged: false,
})
describe('退件测量核对', () => {
  it('刷新后仍是同一次测量和算费', () => {
    const port = storage()
    saveReturnMeasureAttempt(port, 1, attempt())
    expect(readReturnMeasureAttempt(port, 1)?.feePayload.clientRequestId).toBe('fee-id')
    clearReturnMeasureAttempt(port, 1)
    expect(readReturnMeasureAttempt(port, 1)).toBeNull()
  })
  it('损坏的测量核对不能被当成没有原操作', () => {
    const port = storage()
    port.setItem('erp:return-measure:1', '{bad')
    expect(() => readReturnMeasureAttempt(port, 1)).toThrow('不要另起一次测量')
  })
})
