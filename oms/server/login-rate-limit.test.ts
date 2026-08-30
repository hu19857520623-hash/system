import test from 'node:test'
import assert from 'node:assert/strict'
import { LoginRateLimiter } from './login-rate-limit.js'

test('locks a key after the configured number of failures', () => {
  let now = 1_000
  const limiter = new LoginRateLimiter(2, 15 * 60_000, 10 * 60_000, () => now)

  limiter.assertAllowed('user-a')
  limiter.recordFailure('user-a')
  limiter.assertAllowed('user-a')
  limiter.recordFailure('user-a')

  assert.throws(() => limiter.assertAllowed('user-a'), (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.equal((err as Error & { status?: number }).status, 429)
    assert.match(err.message, /登录失败次数过多/)
    return true
  })
})

test('success clears prior failures so the next login is allowed', () => {
  const limiter = new LoginRateLimiter(2, 15 * 60_000, 10 * 60_000, () => 1_000)
  limiter.recordFailure('user-b')
  limiter.recordSuccess('user-b')
  assert.doesNotThrow(() => limiter.assertAllowed('user-b'))
})

test('expired lock window is pruned and allows a new attempt', () => {
  let now = 1_000
  const limiter = new LoginRateLimiter(1, 1_000, 5_000, () => now)
  limiter.recordFailure('user-c')
  assert.throws(() => limiter.assertAllowed('user-c'))
  now = 7_000
  assert.doesNotThrow(() => limiter.assertAllowed('user-c'))
})
