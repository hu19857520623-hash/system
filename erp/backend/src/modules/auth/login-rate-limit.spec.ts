import { LoginRateLimiter } from './login-rate-limit'

describe('LoginRateLimiter', () => {
  it('locks after repeated failures in the window', () => {
    let now = 1_000
    const limiter = new LoginRateLimiter(3, 60_000, 120_000, () => now)
    limiter.assertAllowed('admin')
    limiter.recordFailure('admin')
    limiter.recordFailure('admin')
    limiter.recordFailure('admin')
    expect(() => limiter.assertAllowed('admin')).toThrow(/登录失败次数过多/)
  })

  it('clears failures after a successful login', () => {
    const limiter = new LoginRateLimiter(2, 60_000, 120_000, () => 1_000)
    limiter.recordFailure('admin')
    limiter.recordSuccess('admin')
    expect(() => limiter.assertAllowed('admin')).not.toThrow()
  })
})
