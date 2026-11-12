import { describe, expect, it } from 'vitest'
import { clearReturnInspectAttempt, readReturnInspectAttempt, saveReturnInspectAttempt, type ReturnInspectAttempt } from './returnInspectAttempt'
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const attempt = (): ReturnInspectAttempt => ({
  returnId: 7, returnNo: 'RT-1', uncertain: true, contentChanged: false,
  payload: { clientRequestId: 'inspect-id', inspectionResult: 'pass', attachments: [{ fileName: 'a.jpg', contentBase64: 'YQ==' }] },
})
describe('退件质检核对', () => {
  it('刷新后仍是同一次质检', () => {
    const port = storage()
    saveReturnInspectAttempt(port, 1, attempt())
    expect(readReturnInspectAttempt(port, 1)?.payload.clientRequestId).toBe('inspect-id')
    clearReturnInspectAttempt(port, 1)
    expect(readReturnInspectAttempt(port, 1)).toBeNull()
  })
  it('损坏的质检核对不能被当成没有原操作', () => {
    const port = storage()
    port.setItem('erp:return-inspect:1', '{bad')
    expect(() => readReturnInspectAttempt(port, 1)).toThrow('不要另起一次质检')
  })
})
