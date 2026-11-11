import { describe, expect, it } from 'vitest'
import { syncRetryFeedback } from './syncRetryFeedback'
describe('sync retry feedback', () => {
  it('only announces success for acknowledged success', () => {
    expect(syncRetryFeedback({ status: 'success' }).success).toBe(true)
    for (const status of ['failed', 'pending', 'processing', undefined]) expect(syncRetryFeedback({ status }).success).toBe(false)
    expect(syncRetryFeedback(null).message).toContain('尚未确认')
  })
})
