import { describe, expect, it, vi } from 'vitest'
import { operatePackAttempt, readPackAttempts, savePackAttempt, withPackLock, type PackAttempt } from './outboundPacking'
const original: PackAttempt = { outboundId: 61, outboundNo: 'DO-61', order: { id: 61, outboundNo: 'DO-61', status: 'reviewing', omsPreDeduct: {preDeductTotal:44.4} },
  payload: { clientRequestId: 'original-pack', reviewSource: 'pick_list', isPalletized: false, palletInfo: '', cartons: [{ lengthCm: 30, widthCm: 20, heightCm: 10, grossWeightKg: 2 }] } }

function storage() {
  const values = new Map<string, string>()
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
}
const receipt = (outcome: string) => ({ id: 61, outboundNo: 'DO-61', requestId: 'original-pack', currentStatus: outcome === 'confirmed' ? 'shipped' : 'picking', outcome })
describe('复核打包原请求保存与恢复', () => {
  it('reopens the exact original and scopes it to the original account', () => {
    const s = storage();savePackAttempt(s, 59, original)
    expect(readPackAttempts(s, 59)).toEqual([original]);expect(readPackAttempts(s, 51)).toEqual([])
    expect(() => savePackAttempt(s, 59, { ...original, payload: { ...original.payload, cartons: [{ lengthCm: 0, widthCm: 20, heightCm: 10, grossWeightKg: 2 }] } })).toThrow('资料不完整')
    expect(() => savePackAttempt(s, 59, { ...original, payload: { ...original.payload, clientRequestId: 'replacement' } })).toThrow('不能覆盖')
  })
  it('does not post when storage cannot save or is corrupt', () => {
    const s = storage();s.setItem('erp:outbound-packing:59', 'broken')
    expect(() => savePackAttempt(s, 59, original)).toThrow('无法读取')
    expect(() => savePackAttempt({ ...storage(), setItem: () => { throw new Error('quota') } }, 59, original)).toThrow('本次尚未提交')
  })
  it('survives a committed response loss, reloads and reads the original without another post', async () => {
    const s = storage();savePackAttempt(s, 59, original)
    const api = { packRequest: vi.fn().mockResolvedValueOnce(receipt('unknown')).mockResolvedValue(receipt('confirmed')), pack: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }
    await expect(operatePackAttempt(api, s, 59, original, 'retry', () => {})).rejects.toThrow('原复核打包请求仍需核对')
    const restored = readPackAttempts(s, 59)[0]!
    await expect(operatePackAttempt(api, s, 59, restored, 'retry', () => {})).resolves.toMatchObject({ outcome: 'confirmed', currentStatus: 'shipped' })
    expect(api.pack).toHaveBeenCalledExactlyOnceWith(61, original.payload)
    expect(readPackAttempts(s, 59)).toEqual([])
  })
  it.each([400, 401, 403, 409, 422, 429, 500, 503])('retains the original on HTTP %s, including conflicts', async status => {
    const s = storage();savePackAttempt(s, 59, original)
    const api = { packRequest: vi.fn().mockRejectedValue({ status, message: 'Forbidden' }) }
    await expect(operatePackAttempt(api, s, 59, original, 'check', () => {})).rejects.toThrow(/原.*请求.*保留|原复核打包请求仍需核对/)
    expect(readPackAttempts(s, 59)).toEqual([original])
  })
  it('unknown lookup keeps the frozen request and never resubmits during check', async () => {
    const s = storage();savePackAttempt(s, 59, original)
    const api = { packRequest: vi.fn().mockResolvedValue(receipt('unknown')), pack: vi.fn() }
    await expect(operatePackAttempt(api, s, 59, original, 'check', () => {})).resolves.toMatchObject({ outcome: 'unknown' })
    expect(api.pack).not.toHaveBeenCalled();expect(readPackAttempts(s, 59)).toEqual([original])
  })
  it.each(['confirmed', 'cancelled'])('cancellation resolves only the original immutable %s outcome', async outcome => {
    const s = storage();savePackAttempt(s, 59, original)
    const api = { cancelPackRequest: vi.fn().mockResolvedValue(receipt(outcome)), pack: vi.fn() }
    await expect(operatePackAttempt(api, s, 59, original, 'cancel', () => {})).resolves.toMatchObject({ outcome })
    expect(api.cancelPackRequest).toHaveBeenCalledWith(61, 'original-pack');expect(api.pack).not.toHaveBeenCalled()
    expect(readPackAttempts(s, 59)).toEqual([])
  })
  it('a lost cancellation response remains available to a later read', async () => {
    const s = storage();savePackAttempt(s, 59, original)
    await expect(operatePackAttempt({ cancelPackRequest: vi.fn().mockRejectedValue(new TypeError()) }, s, 59, original, 'cancel', () => {})).rejects.toThrow('仍需核对')
    expect(readPackAttempts(s, 59)).toEqual([original])
    await expect(operatePackAttempt({ packRequest: vi.fn().mockResolvedValue(receipt('cancelled')) }, s, 59, original, 'check', () => {})).resolves.toMatchObject({ outcome: 'cancelled' })
  })
  it.each(['account', 'permission', 'unmount'])('a changed %s blocks subsequent post and cleanup', async () => {
    const s = storage();savePackAttempt(s, 59, original);let live = true
    const api = { packRequest: vi.fn(async () => { live = false;return receipt('unknown') }), pack: vi.fn() }
    await expect(operatePackAttempt(api, s, 59, original, 'retry', () => { if (!live) throw new Error('页面身份已变化') })).rejects.toThrow('身份已变化')
    expect(api.pack).not.toHaveBeenCalled();expect(readPackAttempts(s, 59)).toEqual([original])
  })
  it('does not clear or reuse a replaced request or a mismatched receipt', async () => {
    const s = storage();savePackAttempt(s, 59, original)
    await expect(operatePackAttempt({ packRequest: vi.fn().mockResolvedValue({ ...receipt('confirmed'), requestId: 'other' }) }, s, 59, original, 'check', () => {})).rejects.toThrow('无法核对')
    const api = { packRequest: vi.fn() }
    await expect(operatePackAttempt(api, s, 59, { ...original, payload: { ...original.payload, clientRequestId: 'other' } }, 'retry', () => {})).rejects.toThrow('本机原复核打包信息已变化')
    expect(api.packRequest).not.toHaveBeenCalled();expect(readPackAttempts(s, 59)).toEqual([original])
  })
  it('submits only the already saved original and verifies its receipt before clearing', async () => {
    const s = storage();savePackAttempt(s, 59, original)
    const api = { packRequest: vi.fn().mockResolvedValueOnce(receipt('unknown')).mockResolvedValue(receipt('confirmed')),
      pack: vi.fn(async (_id, payload) => { expect(readPackAttempts(s, 59)[0]?.payload).toEqual(payload);payload.cartons[0].grossWeightKg = 99 }) }
    await expect(operatePackAttempt(api, s, 59, original, 'retry', () => {})).resolves.toMatchObject({ outcome: 'confirmed' })
    expect(original.payload.cartons[0]?.grossWeightKg).toBe(2);expect(api.packRequest).toHaveBeenCalledTimes(2)
  })
  it('keeps a confirmed receipt recoverable when the session changes before its reply is processed', async () => {
    const s = storage();savePackAttempt(s, 59, original);let live = true
    const api = { packRequest: vi.fn(async () => { live = false;return receipt('confirmed') }) }
    await expect(operatePackAttempt(api, s, 59, original, 'check', () => { if (!live) throw new Error('原登录已变化') })).rejects.toThrow('原登录已变化')
    expect(readPackAttempts(s, 59)).toEqual([original])
  })
  it('a storage cleanup failure keeps the confirmed original available for another check', async () => {
    const s = storage();savePackAttempt(s, 59, original)
    const api = { packRequest: vi.fn().mockResolvedValue(receipt('confirmed')) }
    await expect(operatePackAttempt(api, { ...s, removeItem: () => { throw new Error('storage blocked') } }, 59, original, 'check', () => {})).rejects.toThrow('本机核对信息未能清除')
    expect(readPackAttempts(s, 59)).toEqual([original])
    await expect(operatePackAttempt(api, s, 59, original, 'check', () => {})).resolves.toMatchObject({ outcome: 'confirmed' })
  })
  it('does not start an action if another tab holds the account lock', async () => {
    const action = vi.fn()
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: (lock: null) => unknown) => work(null) } })
    try { await expect(withPackLock(59, action)).rejects.toThrow('另一个页面');expect(action).not.toHaveBeenCalled() }
    finally { vi.unstubAllGlobals() }
  })
})
