import { describe, expect, it } from 'vitest'
import { returnAttemptMessage, returnAttemptOutcome } from './returnAttempt'

describe('退件失败后的原操作', () => {
  it('内容已变化时保留原操作，并禁止修改后重试', () => {
    const outcome = returnAttemptOutcome(409, '同一次操作的内容已变化。请结束本次后再重新填写，不要修改后重复提交')
    expect(outcome).toEqual({ uncertain: true, contentChanged: true, statusChanged: false, holdReason: null })
    expect(returnAttemptMessage('退件处理', outcome)).toContain('不要修改后重复提交')
  })

  it('网络中断仍可沿用原操作重试，状态变化则刷新而不是再提交', () => {
    expect(returnAttemptOutcome(Number.NaN, '')).toMatchObject({ uncertain: true, contentChanged: false, statusChanged: false })
    expect(returnAttemptOutcome(409, '单据状态已变化')).toEqual({ uncertain: false, contentChanged: false, statusChanged: true, holdReason: null })
    expect(returnAttemptOutcome(409, '退件状态已变化，请刷新退件记录后再收货')).toEqual({ uncertain: false, contentChanged: false, statusChanged: true, holdReason: null })
    expect(returnAttemptOutcome(409, '原退件操作已核对结束，请刷新单据后重新操作')).toEqual({ uncertain: false, contentChanged: false, statusChanged: true, holdReason: null })
    expect(returnAttemptMessage('收货', { uncertain: true, contentChanged: false })).toContain('沿用同一次操作')
    expect(returnAttemptOutcome(401, '登录已失效')).toMatchObject({ uncertain: true, holdReason: 'login' })
    expect(returnAttemptMessage('收货', { uncertain: true, contentChanged: false, holdReason: 'login' })).toContain('重新登录')
    expect(returnAttemptOutcome(403, '当前岗位无权限')).toMatchObject({ uncertain: true, holdReason: 'permission' })
    expect(returnAttemptOutcome(429, '请求过于频繁')).toMatchObject({ uncertain: true, holdReason: 'throttle' })
  })

  it('明确校验失败不保留待重试', () => {
    expect(returnAttemptOutcome(400, '请填写本次上架的 SKU')).toEqual({ uncertain: false, contentChanged: false, statusChanged: false, holdReason: null })
    expect(returnAttemptMessage('质检', { uncertain: false, contentChanged: false })).toBe('')
  })
})
