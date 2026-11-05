import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReturnMeasureAttempt, type ReturnMeasurement, type ReturnMeasureResult } from './useReturnMeasureAttempt'

const intent: Omit<ReturnMeasurement, 'clientRequestId'> = { id: 1, returnNo: 'RT-ONE', expectedRevision: 'a'.repeat(64), mode: 'replace', cartons: [{ lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 1 }] }
const applied: ReturnMeasureResult = { id: 1, outcome: 'applied', estimatedFeeTotal: 8 }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function storage() {
  const data = new Map<string, string>()
  return { data, getItem: vi.fn((k: string) => data.get(k) ?? null), setItem: vi.fn((k: string, v: string) => { data.set(k, v) }), removeItem: vi.fn((k: string) => { data.delete(k) }) }
}
const owners: ReturnType<typeof effectScope>[] = []
function setup(store = storage(), request = vi.fn<(p: ReturnMeasurement, close: boolean) => Promise<ReturnMeasureResult>>().mockResolvedValue(applied), lock = async (_key: string, work: () => boolean) => work()) {
  const owner = effectScope(), actor = ref('7'), scope = ref<string | null>('actor7:receive')
  owners.push(owner)
  const form = owner.run(() => useReturnMeasureAttempt({ actor: () => actor.value, scope: () => scope.value, storage: store, request, lock }))!
  return { owner, actor, scope, store, request, form }
}
afterEach(() => { for (const owner of owners.splice(0)) owner.stop(); vi.useRealTimers() })

describe('original return measurement recovery', () => {
  it('persists before sending, survives a lost response and refresh, then replays the exact UUID and contents', async () => {
    const store = storage(), request = vi.fn(async (p: ReturnMeasurement) => {
      expect(store.getItem('erp.return.measure-fees.7')).toBe(JSON.stringify(p))
      throw Error('connection lost after commit')
    })
    const first = setup(store, request)
    await first.form.start(intent)
    const original = structuredClone(first.form.pending.value!)
    first.owner.stop()
    const next = setup(store)
    expect(next.form.pending.value).toEqual(original)
    await expect(next.form.resume()).resolves.toEqual(applied)
    expect(next.request).toHaveBeenCalledWith(original, false)
    expect(store.getItem('erp.return.measure-fees.7')).toBeNull()
    expect(next.form.feedback.value).toContain('已确认保存')
  })

  it('never sends a request when original contents cannot be durably stored', async () => {
    const h = setup()
    h.store.setItem.mockImplementation(() => { throw Error('quota exceeded') })
    await h.form.start(intent)
    expect(h.request).not.toHaveBeenCalled()
    expect(h.form.blocked.value).toBe(true)
    expect(h.form.feedback.value).toContain('本次尚未提交')
  })

  it('preserves the original if receipt cleanup fails, making the next retry safe', async () => {
    const h = setup()
    h.store.removeItem.mockImplementationOnce(() => { throw Error('storage unavailable') })
    await expect(h.form.start(intent)).resolves.toBeNull()
    expect(h.form.pending.value).not.toBeNull()
    const original = structuredClone(h.form.pending.value)
    await expect(h.form.resume()).resolves.toEqual(applied)
    expect(h.request.mock.calls.map(call => call[0])).toEqual([original, original])
    expect(h.form.pending.value).toBeNull()
  })

  it('closes only the preserved original payload and does not fabricate a new request', async () => {
    const h = setup()
    h.request.mockRejectedValueOnce(Error('network timeout')).mockResolvedValueOnce({ id: 1, outcome: 'closed', estimatedFeeTotal: null })
    await h.form.start(intent)
    const original = structuredClone(h.form.pending.value!)
    await expect(h.form.close()).resolves.toMatchObject({ outcome: 'closed' })
    expect(h.request.mock.calls[1]).toEqual([original, true])
    expect(h.form.pending.value).toBeNull()
    expect(h.form.feedback.value).toContain('不会再提交')
  })

  it('does not clear another actor or react to a previous login response, but restores the old original on return', async () => {
    const pending = deferred<ReturnMeasureResult>(), h = setup()
    h.request.mockReturnValueOnce(pending.promise)
    const running = h.form.start(intent)
    await Promise.resolve(); await Promise.resolve()
    expect(h.form.pending.value).not.toBeNull()
    h.actor.value = '8'; h.scope.value = 'actor8:receive'
    pending.resolve(applied)
    await running
    expect(h.form.pending.value).toBeNull()
    expect(h.form.feedback.value).toBe('')
    expect(h.store.getItem('erp.return.measure-fees.7')).not.toBeNull()
    h.actor.value = '7'; h.scope.value = 'actor7:new-login'
    expect(h.form.pending.value?.returnNo).toBe('RT-ONE')
    await expect(h.form.resume()).resolves.toEqual(applied)
  })

  it('times out without discarding the original and ignores the old promise after explicit close', async () => {
    vi.useFakeTimers()
    const pending = deferred<ReturnMeasureResult>(), h = setup()
    h.request.mockReturnValueOnce(pending.promise)
    const running = h.form.start(intent)
    await Promise.resolve(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(30000)
    await running
    expect(h.form.pending.value).not.toBeNull()
    expect(h.form.busy.value).toBe(false)
    expect(h.form.feedback.value).toContain('原请求已保留')
    h.request.mockResolvedValueOnce({ id: 1, outcome: 'closed', estimatedFeeTotal: null })
    await h.form.close()
    const feedback = h.form.feedback.value
    pending.resolve(applied)
    await Promise.resolve()
    expect(h.form.pending.value).toBeNull()
    expect(h.form.feedback.value).toBe(feedback)
  })

  it('refuses corrupt persisted data and reloads it only after it becomes readable', () => {
    const store = storage()
    store.data.set('erp.return.measure-fees.7', '{broken')
    const h = setup(store)
    expect(h.form.blocked.value).toBe(true)
    expect(h.request).not.toHaveBeenCalled()
    store.data.set('erp.return.measure-fees.7', JSON.stringify({ ...intent, clientRequestId: '10000000-0000-4000-8000-000000000001' }))
    h.form.reload()
    expect(h.form.blocked.value).toBe(false)
    expect(h.form.pending.value?.id).toBe(1)
  })

  it('prevents a second tab from starting an old intent even if the first already settled before its lock is granted', async () => {
    const store = storage(), grants: (() => void)[] = []
    const lock = (_key: string, work: () => boolean) => new Promise<boolean>(resolve => { grants.push(() => resolve(work())) })
    const first = setup(store, undefined, lock), second = setup(store, undefined, lock)
    const a = first.form.start(intent), b = second.form.start(intent)
    grants[0]!()
    await a
    grants[1]!()
    await b
    expect(first.request).toHaveBeenCalledTimes(1)
    expect(second.request).not.toHaveBeenCalled()
    expect(second.form.feedback.value).toContain('另一退件页面')
  })

  it('keeps pending data on lost permissions, prevents new requests, and permits same-account recovery after restoration', async () => {
    const h = setup()
    h.request.mockRejectedValueOnce(Error('temporary failure'))
    await h.form.start(intent)
    const original = h.form.pending.value
    h.scope.value = null
    await h.form.resume()
    expect(h.request).toHaveBeenCalledTimes(1)
    h.scope.value = 'actor7:restored'
    expect(h.form.pending.value).toEqual(original)
    await expect(h.form.resume()).resolves.toEqual(applied)
  })

  it('freezes during lock acquisition and cancels a stale preparation before storing or submitting it', async () => {
    let grant!: () => void
    const lock = (_key: string, work: () => boolean) => new Promise<boolean>(resolve => { grant = () => resolve(work()) })
    const h = setup(undefined, undefined, lock)
    const running = h.form.start(intent)
    expect(h.form.busy.value).toBe(true)
    await expect(h.form.start(intent)).resolves.toBeNull()
    h.scope.value = null
    grant()
    await expect(running).resolves.toBeNull()
    expect(h.request).not.toHaveBeenCalled()
    expect(h.store.getItem('erp.return.measure-fees.7')).toBeNull()
  })

  it('does not discard original contents when a response cannot be matched to its return', async () => {
    const h = setup()
    h.request.mockResolvedValueOnce({ ...applied, id: 2 })
    await expect(h.form.start(intent)).resolves.toBeNull()
    expect(h.form.pending.value?.id).toBe(1)
    expect(h.form.feedback.value).toContain('原请求已保留')
    expect(h.store.getItem('erp.return.measure-fees.7')).not.toBeNull()
  })
})
