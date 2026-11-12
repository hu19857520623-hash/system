import { describe, expect, it } from 'vitest'
import { clearReturnDisposeAttempt, readReturnDisposeAttempt, saveReturnDisposeAttempt, type ReturnDisposeAttempt } from './returnDisposeAttempt'
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
const attempt = (): ReturnDisposeAttempt => ({ id: 7, returnNo: 'RT-1', payload: { clientRequestId: 'dispose-id', processRemark: '客户确认不留，仓库已销毁' }, contentChanged: false })
describe('退件销毁核对', () => {
  it('刷新后仍是同一次销毁', () => {
    const port = storage()
    saveReturnDisposeAttempt(port, 1, attempt())
    expect(readReturnDisposeAttempt(port, 1)?.payload.clientRequestId).toBe('dispose-id')
    clearReturnDisposeAttempt(port, 1)
    expect(readReturnDisposeAttempt(port, 1)).toBeNull()
  })
  it('损坏的销毁核对不能被当成没有原操作', () => {
    const port = storage()
    port.setItem('erp:return-dispose:1', '{bad')
    expect(() => readReturnDisposeAttempt(port, 1)).toThrow('不要另起一次销毁')
  })
})
