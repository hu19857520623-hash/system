import { describe, expect, it, vi } from 'vitest'
import { clearStageAttempt, readStageAttempts, runStageAttempt, saveStageAttempt, stageContentMismatch, type OutboundStageAttempt } from './outboundStageAttempt'

const attempt: OutboundStageAttempt = {
  outboundId: 7,
  outboundNo: 'DO-7',
  clientRequestId: 'pick-1',
  payload: { pickSource: 'pick_list', items: [{ id: 1, allocations: [{ locationCode: 'A-01', qty: 2 }] }] },
}

function memory() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('出库拣货和复核的原请求', () => {
  it('内容不同时保留原请求，结束后不能再重试', async () => {
    const storage = memory()
    saveStageAttempt(storage, 3, 'pick', attempt)
    const send = vi.fn().mockRejectedValue({ status: 409, message: '原拣货操作对应的单据或内容不同。请结束本次后再重新填写，勿修改后重试' })
    await expect(runStageAttempt(send, storage, 3, 'pick', attempt)).rejects.toThrow('不要修改后重试')
    expect(readStageAttempts(storage, 3, 'pick')[0]?.contentChanged).toBe(true)
    expect(stageContentMismatch('原复核操作对应的单据或外箱内容不同。请结束本次后再重新填写，勿修改后重试')).toBe(true)
    expect(stageContentMismatch('原标记请求对应的单据、操作人或内容不同。请结束本次后再重新填写，不要用同一个请求继续标记。')).toBe(true)
    clearStageAttempt(storage, 3, 'pick', { ...attempt, contentChanged: true })
    expect(readStageAttempts(storage, 3, 'pick')).toEqual([])
  })

  it('结果丢失时重试仍使用原标识，明确拒绝后清掉原请求', async () => {
    const storage = memory()
    saveStageAttempt(storage, 3, 'pack', { ...attempt, clientRequestId: 'pack-1', payload: { cartons: [{ lengthCm: 1, widthCm: 1, heightCm: 1, grossWeightKg: 1 }] } })
    const saved = readStageAttempts(storage, 3, 'pack')[0]!
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce({ status: 400, message: '当前状态不可复核（需先完成拣货）' })
    await expect(runStageAttempt(send, storage, 3, 'pack', saved)).rejects.toThrow('尚未确认')
    expect(readStageAttempts(storage, 3, 'pack')[0]?.clientRequestId).toBe('pack-1')
    await expect(runStageAttempt(send, storage, 3, 'pack', saved)).rejects.toThrow('请刷新出库单')
    expect(readStageAttempts(storage, 3, 'pack')).toEqual([])
  })

  it('登录失效、岗位变化和请求频繁时保留原出库操作', async () => {
    const storage = memory()
    saveStageAttempt(storage, 3, 'pick', attempt)
    await expect(runStageAttempt(vi.fn().mockRejectedValue({ status: 401, message: 'Unauthorized' }), storage, 3, 'pick', attempt)).rejects.toThrow('重新登录')
    await expect(runStageAttempt(vi.fn().mockRejectedValue({ status: 403, message: 'Forbidden' }), storage, 3, 'pick', attempt)).rejects.toThrow('原岗位权限')
    await expect(runStageAttempt(vi.fn().mockRejectedValue({ status: 429, message: 'Too Many Requests' }), storage, 3, 'pick', attempt)).rejects.toThrow('稍后再重试')
    expect(readStageAttempts(storage, 3, 'pick')[0]?.clientRequestId).toBe('pick-1')
    expect(readStageAttempts(storage, 3, 'pick')[0]?.contentChanged).toBeUndefined()
  })
})
