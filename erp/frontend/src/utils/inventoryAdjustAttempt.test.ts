import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useInventoryAdjustAttempt } from './inventoryAdjustAttempt'

describe('durable original logistics transfer', () => {
  const payload = { id: 1, qty: 3, locationCode: 'BIN-A', customerCode: 'TKL' }
  function fixture() {
    const map = new Map<string, string>()
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } }
    const actor = ref('7'), scope = ref('session7'), allowed = ref(true), request = vi.fn()
    function mount() { const owner = effectScope(); const attempt = owner.run(() => useInventoryAdjustAttempt({ actor: () => actor.value, scope: () => scope.value, allowed: () => allowed.value, claimLock: async (_name, prepare) => prepare(), storage, request }))!; return { owner, attempt } }
    return { storage, map, actor, scope, allowed, request, mount }
  }
  it('preserves UUID and original payload through lost response and page remount', async () => {
    const f = fixture(), first = f.mount(); f.request.mockRejectedValueOnce(new Error('响应丢失'))
    expect(await first.attempt.start(payload)).toBe(false)
    const original = f.request.mock.calls[0][0]
    first.owner.stop(); const second = f.mount()
    expect(second.attempt.pending.value).toEqual(original)
    f.request.mockResolvedValueOnce({ duplicate: true })
    expect(await second.attempt.resume()).toBe(true)
    expect(f.request.mock.calls[1][0]).toEqual(original)
    expect(f.storage.getItem('erp.inventory.adjust.7')).toBeNull(); second.owner.stop()
  })
  it('does not submit if durable storage fails', async () => {
    const f = fixture(); f.storage.setItem = () => { throw Error('disk') }; const p = f.mount()
    expect(await p.attempt.start(payload)).toBe(false); expect(f.request).not.toHaveBeenCalled(); p.owner.stop()
  })
  it('ignores a late success after account switch and retains original actor recovery', async () => {
    const f = fixture(), p = f.mount(); let finish!: (v: unknown) => void
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const running = p.attempt.start(payload); await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1)); f.actor.value = '8'; f.scope.value = 'session8'; await nextTick(); finish({})
    expect(await running).toBe(false); expect(f.storage.getItem('erp.inventory.adjust.7')).not.toBeNull()
    expect(p.attempt.pending.value).toBeNull(); p.owner.stop()
  })
  it('freezes new operations while uncertain or permission is revoked', async () => {
    const f = fixture(), p = f.mount(); f.request.mockRejectedValue(new Error('lost'))
    await p.attempt.start(payload); await p.attempt.start({ ...payload, qty: 4 }); expect(f.request).toHaveBeenCalledTimes(1)
    f.allowed.value = false; expect(await p.attempt.resume()).toBe(false); expect(f.request).toHaveBeenCalledTimes(1); p.owner.stop()
  })
  it('内容不同时停止继续原调整，核对后可结束本次', async () => {
    const f = fixture(), p = f.mount()
    f.request.mockRejectedValueOnce(new Error('原库存调整请求内容不同，请核对原请求，勿修改后重复提交'))
    expect(await p.attempt.start(payload)).toBe(false)
    expect(p.attempt.pending.value?.contentChanged).toBe(true)
    expect(await p.attempt.resume()).toBe(false)
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(p.attempt.endChanged()).toBe(true)
    expect(f.storage.getItem('erp.inventory.adjust.7')).toBeNull()
    p.owner.stop()
  })
})
