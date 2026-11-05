import { describe, it, expect, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useReturnActionAttempt } from './useReturnActionAttempt'
const lock = async (_name: string, run: () => Promise<unknown>) => run()
function storage() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, removeItem: (key: string) => { map.delete(key) } } }
const input = { id: 1, returnNo: 'RT-ONE', steps: [{ action: 'measure' as const, body: { cartons: [{ lengthCm: 20 }] } }, { action: 'calculateFees' as const, body: {} }] }
describe('return original action recovery', () => {
  it('serializes two tabs so a second intent cannot overwrite the first uncertain request', async () => {
    const saved = storage(), scope = effectScope(), request = vi.fn().mockRejectedValue(Error('响应未知'))
    let queue: Promise<unknown> = Promise.resolve()
    const sharedLock = (_name: string, run: () => Promise<unknown>) => { const next = queue.then(run); queue = next.catch(() => undefined); return next }
    const first = scope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => 'session', allowed: () => true, storage: saved, lock: sharedLock, request }))!
    const second = scope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => 'session', allowed: () => true, storage: saved, lock: sharedLock, request }))!
    await Promise.all([first.start(input), second.start({ ...input, id: 2, returnNo: 'RT-TWO' })])
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.parse(saved.getItem('erp.returns.original.1')!).id).toBe(1)
    scope.stop()
  })
  it('only clears an intent after server confirms executed and seals unexecuted steps', async () => {
    const saved = storage(), scope = effectScope(), close = vi.fn().mockResolvedValueOnce({ outcome: 'confirmed' }).mockResolvedValueOnce({ outcome: 'cancelled' })
    const attempt = scope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => 'session', allowed: () => true, storage: saved, lock, request: vi.fn().mockRejectedValue(Error('响应未知')), close }))!
    await attempt.start(input)
    const nonces = attempt.pending.value!.steps.map(step => step.clientRequestId)
    expect(await attempt.close()).toBe(true)
    expect(close.mock.calls.map(call => call[1].clientRequestId)).toEqual(nonces)
    expect(saved.getItem('erp.returns.original.1')).toBeNull()
    scope.stop()
  })
  it('keeps frozen original payload when close response is unknown', async () => {
    const saved = storage(), scope = effectScope()
    const attempt = scope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => 'session', allowed: () => true, storage: saved, lock, request: vi.fn().mockRejectedValue(Error('响应未知')), close: vi.fn().mockRejectedValue(Error('核对超时')) }))!
    await attempt.start(input); const raw = saved.getItem('erp.returns.original.1')
    expect(await attempt.close()).toBe(false)
    expect(saved.getItem('erp.returns.original.1')).toBe(raw)
    scope.stop()
  })
  it('persists the acknowledged step and reload resumes only the original fee request', async () => {
    const saved = storage(), request = vi.fn().mockResolvedValueOnce({ status: 'measured' }).mockRejectedValueOnce(Error('响应丢失'))
    const firstScope = effectScope(), first = firstScope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => 'session', allowed: () => true, storage: saved, lock, request }))!
    await first.start(input)
    expect(first.pending.value?.index).toBe(1)
    const nonce = first.pending.value!.steps[1].clientRequestId
    firstScope.stop()
    const secondScope = effectScope(), retry = vi.fn().mockResolvedValue({ status: 'fee_calculated' })
    const second = secondScope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => 'session2', allowed: () => true, storage: saved, lock, request: retry }))!
    await second.resume()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[0][1]).toMatchObject({ action: 'calculateFees', clientRequestId: nonce })
    expect(saved.getItem('erp.returns.original.1')).toBeNull()
    secondScope.stop()
  })
  it('does not send anything when original payload cannot be stored', async () => {
    const scope = effectScope(), request = vi.fn(), saved = storage()
    const attempt = scope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => 'session', allowed: () => true, storage: { ...saved, setItem: () => { throw Error('存储空间不足') } }, lock, request }))!
    await attempt.start(input)
    expect(request).not.toHaveBeenCalled()
    expect(attempt.feedback.value).toContain('保存或读取未确认')
    scope.stop()
  })
  it('keeps old actor intent and ignores its late response after account changes', async () => {
    const actor = ref('1'), saved = storage(), scope = effectScope()
    let complete!: (value: unknown) => void
    const request = vi.fn(() => new Promise(resolve => { complete = resolve }))
    const attempt = scope.run(() => useReturnActionAttempt({ actor: () => actor.value, scope: () => actor.value, allowed: () => true, storage: saved, lock, request }))!
    const pending = attempt.start({ ...input, steps: [input.steps[0]!] })
    await Promise.resolve(); await Promise.resolve()
    actor.value = '2'; complete({ status: 'measured' }); await pending
    expect(saved.getItem('erp.returns.original.1')).not.toBeNull()
    expect(attempt.pending.value).toBeNull()
    scope.stop()
  })
  it('does not overwrite an uncertain request with new form content or send after permission loss', async () => {
    const saved = storage(), scope = effectScope(), allowed = ref(true), request = vi.fn().mockRejectedValue(Error('响应未知'))
    const attempt = scope.run(() => useReturnActionAttempt({ actor: () => '1', scope: () => String(allowed.value), allowed: () => allowed.value, storage: saved, lock, request }))!
    await attempt.start(input); const original = saved.getItem('erp.returns.original.1')
    await attempt.start({ ...input, id: 2 })
    expect(saved.getItem('erp.returns.original.1')).toBe(original)
    expect(request).toHaveBeenCalledTimes(1)
    allowed.value = false; await attempt.resume()
    expect(attempt.blocked.value).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    scope.stop()
  })
})
