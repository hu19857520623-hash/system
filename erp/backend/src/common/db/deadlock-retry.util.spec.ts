import { isDeadlockError, withDeadlockRetry } from './deadlock-retry.util'

describe('事务死锁安全重试', () => {
  it('识别死锁/锁等待/事务冲突错误', () => {
    expect(isDeadlockError({ code: 'P2034', message: 'deadlock' })).toBe(true)
    expect(isDeadlockError({ code: 'P2028', message: 'expired' })).toBe(true)
    expect(isDeadlockError(new Error('Raw query failed. Code: `1213`. Message: `Deadlock found when trying to get lock; try restarting transaction`'))).toBe(true)
    expect(isDeadlockError(new Error('Lock wait timeout exceeded'))).toBe(true)
    expect(isDeadlockError(new Error('普通业务错误'))).toBe(false)
    expect(isDeadlockError(null)).toBe(false)
  })

  it('仅对死锁重试一次，成功后返回结果', async () => {
    let calls = 0
    const result = await withDeadlockRetry(async () => {
      calls++
      if (calls === 1) throw new Error('Deadlock found when trying to get lock; try restarting transaction')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  it('非死锁异常不重试直接抛出', async () => {
    let calls = 0
    await expect(withDeadlockRetry(async () => {
      calls++
      throw new Error('业务拒绝')
    })).rejects.toThrow('业务拒绝')
    expect(calls).toBe(1)
  })

  it('重试仍死锁则抛出最后一次异常', async () => {
    let calls = 0
    await expect(withDeadlockRetry(async () => {
      calls++
      throw new Error('Deadlock found')
    })).rejects.toThrow('Deadlock found')
    expect(calls).toBe(2)
  })
})
