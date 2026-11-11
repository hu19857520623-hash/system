import { describe, expect, it, vi } from 'vitest'
import { operatePickAttempt, readPickAttempts, savePickAttempt, withPickLock, type PickAttempt } from './outboundPicking'
const original: PickAttempt = { outboundId: 61, outboundNo: 'DO-61', order: { id: 61, outboundNo: 'DO-61', status: 'picking', pickerId: 59 },
  payload: { clientRequestId: 'original-pick', pickSource: 'pick_list', items: [{ id: 32, allocations: [{ locationCode: 'A-01', qty: 2 }] }] } }
function storage() {
  const values = new Map<string, string>()
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
}
const receipt = (outcome: string) => ({ id: 61, outboundNo: 'DO-61', requestId: 'original-pick', currentStatus: outcome === 'confirmed' ? 'shipped' : 'picking', outcome })
describe('拣货原请求保存与恢复', () => {
  it('reopens the exact original and scopes it to the original account', () => {
    const s = storage();savePickAttempt(s, 59, original)
    expect(readPickAttempts(s, 59)).toEqual([original]);expect(readPickAttempts(s, 51)).toEqual([])
    expect(() => savePickAttempt(s, 59, { ...original, payload: { ...original.payload, items: [] } })).toThrow('资料不完整')
    expect(() => savePickAttempt(s, 59, { ...original, payload: { ...original.payload, clientRequestId: 'replacement' } })).toThrow('不能覆盖')
  })
  it('does not post when storage cannot save or is corrupt', () => {
    const s = storage();s.setItem('erp:outbound-picking:59', 'broken')
    expect(() => savePickAttempt(s, 59, original)).toThrow('无法读取')
    expect(() => savePickAttempt({ ...storage(), setItem: () => { throw new Error('quota') } }, 59, original)).toThrow('本次尚未提交')
  })
  it('survives a committed response loss, reloads and reads the original without another post', async () => {
    const s = storage();savePickAttempt(s, 59, original)
    const api = { pickRequest: vi.fn().mockResolvedValueOnce(receipt('unknown')).mockResolvedValue(receipt('confirmed')), pick: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }
    await expect(operatePickAttempt(api, s, 59, original, 'retry', () => {})).rejects.toThrow('原拣货请求仍需核对')
    const restored = readPickAttempts(s, 59)[0]!
    await expect(operatePickAttempt(api, s, 59, restored, 'retry', () => {})).resolves.toMatchObject({ outcome: 'confirmed', currentStatus: 'shipped' })
    expect(api.pick).toHaveBeenCalledExactlyOnceWith(61, original.payload)
    expect(readPickAttempts(s, 59)).toEqual([])
  })
  it.each([400, 401, 403, 409, 422, 429, 500, 503])('retains the original on HTTP %s, including conflicts', async status => {
    const s = storage();savePickAttempt(s, 59, original)
    const api = { pickRequest: vi.fn().mockRejectedValue({ status, message: 'Forbidden' }) }
    await expect(operatePickAttempt(api, s, 59, original, 'check', () => {})).rejects.toThrow(/原.*请求.*保留|原拣货请求仍需核对/)
    expect(readPickAttempts(s, 59)).toEqual([original])
  })
  it('unknown lookup keeps the frozen request and never resubmits during check', async () => {
    const s = storage();savePickAttempt(s, 59, original)
    const api = { pickRequest: vi.fn().mockResolvedValue(receipt('unknown')), pick: vi.fn() }
    await expect(operatePickAttempt(api, s, 59, original, 'check', () => {})).resolves.toMatchObject({ outcome: 'unknown' })
    expect(api.pick).not.toHaveBeenCalled();expect(readPickAttempts(s, 59)).toEqual([original])
  })
  it.each(['confirmed', 'cancelled'])('cancellation resolves only the original immutable %s outcome', async outcome => {
    const s = storage();savePickAttempt(s, 59, original)
    const api = { cancelPickRequest: vi.fn().mockResolvedValue(receipt(outcome)), pick: vi.fn() }
    await expect(operatePickAttempt(api, s, 59, original, 'cancel', () => {})).resolves.toMatchObject({ outcome })
    expect(api.cancelPickRequest).toHaveBeenCalledWith(61, 'original-pick');expect(api.pick).not.toHaveBeenCalled()
    expect(readPickAttempts(s, 59)).toEqual([])
  })
  it('a lost cancellation response remains available to a later read', async () => {
    const s = storage();savePickAttempt(s, 59, original)
    await expect(operatePickAttempt({ cancelPickRequest: vi.fn().mockRejectedValue(new TypeError()) }, s, 59, original, 'cancel', () => {})).rejects.toThrow('仍需核对')
    expect(readPickAttempts(s, 59)).toEqual([original])
    await expect(operatePickAttempt({ pickRequest: vi.fn().mockResolvedValue(receipt('cancelled')) }, s, 59, original, 'check', () => {})).resolves.toMatchObject({ outcome: 'cancelled' })
  })
  it.each(['account', 'permission', 'unmount'])('a changed %s blocks subsequent post and cleanup', async () => {
    const s = storage();savePickAttempt(s, 59, original);let live = true
    const api = { pickRequest: vi.fn(async () => { live = false;return receipt('unknown') }), pick: vi.fn() }
    await expect(operatePickAttempt(api, s, 59, original, 'retry', () => { if (!live) throw new Error('页面身份已变化') })).rejects.toThrow('身份已变化')
    expect(api.pick).not.toHaveBeenCalled();expect(readPickAttempts(s, 59)).toEqual([original])
  })
  it('does not clear or reuse a replaced request or a mismatched receipt', async () => {
    const s = storage();savePickAttempt(s, 59, original)
    await expect(operatePickAttempt({ pickRequest: vi.fn().mockResolvedValue({ ...receipt('confirmed'), requestId: 'other' }) }, s, 59, original, 'check', () => {})).rejects.toThrow('无法核对')
    const api = { pickRequest: vi.fn() }
    await expect(operatePickAttempt(api, s, 59, { ...original, payload: { ...original.payload, clientRequestId: 'other' } }, 'retry', () => {})).rejects.toThrow('本机原拣货信息已变化')
    expect(api.pickRequest).not.toHaveBeenCalled();expect(readPickAttempts(s, 59)).toEqual([original])
  })
  it('submits only the already saved original and verifies its receipt before clearing', async () => {
    const s = storage();savePickAttempt(s, 59, original)
    const api = { pickRequest: vi.fn().mockResolvedValueOnce(receipt('unknown')).mockResolvedValue(receipt('confirmed')),
      pick: vi.fn(async (_id, payload) => { expect(readPickAttempts(s, 59)[0]?.payload).toEqual(payload);payload.items[0].allocations[0].qty = 99 }) }
    await expect(operatePickAttempt(api, s, 59, original, 'retry', () => {})).resolves.toMatchObject({ outcome: 'confirmed' })
    expect(original.payload.items[0]?.allocations[0]?.qty).toBe(2);expect(api.pickRequest).toHaveBeenCalledTimes(2)
  })
  it('keeps a confirmed receipt recoverable when the session changes before its reply is processed', async () => {
    const s = storage();savePickAttempt(s, 59, original);let live = true
    const api = { pickRequest: vi.fn(async () => { live = false;return receipt('confirmed') }) }
    await expect(operatePickAttempt(api, s, 59, original, 'check', () => { if (!live) throw new Error('原登录已变化') })).rejects.toThrow('原登录已变化')
    expect(readPickAttempts(s, 59)).toEqual([original])
  })
  it('a storage cleanup failure keeps the confirmed original available for another check', async () => {
    const s = storage();savePickAttempt(s, 59, original)
    const api = { pickRequest: vi.fn().mockResolvedValue(receipt('confirmed')) }
    await expect(operatePickAttempt(api, { ...s, removeItem: () => { throw new Error('storage blocked') } }, 59, original, 'check', () => {})).rejects.toThrow('本机核对信息未能清除')
    expect(readPickAttempts(s, 59)).toEqual([original])
    await expect(operatePickAttempt(api, s, 59, original, 'check', () => {})).resolves.toMatchObject({ outcome: 'confirmed' })
  })
  it('does not start an action if another tab holds the account lock', async () => {
    const action = vi.fn()
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: (lock: null) => unknown) => work(null) } })
    try { await expect(withPickLock(59, action)).rejects.toThrow('另一个页面');expect(action).not.toHaveBeenCalled() }
    finally { vi.unstubAllGlobals() }
  })
})
