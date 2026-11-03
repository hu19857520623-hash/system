import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLogisticsTransferAttempt } from './logisticsTransferAttempt'

describe('durable original logistics transfer', () => {
  const payload = { sku: 'SKU-A', fromWarehouseCode: 'LW-A', toWarehouseCode: 'LW-B', qty: 3 }
  function fixture() {
    const map = new Map<string, string>()
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } }
    const actor = ref('7'), scope = ref('session7'), allowed = ref(true), request = vi.fn()
    function mount() { const owner = effectScope(); const attempt = owner.run(() => useLogisticsTransferAttempt({ actor: () => actor.value, scope: () => scope.value, allowed: () => allowed.value, storage, request }))!; return { owner, attempt } }
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
    expect(f.map.size).toBe(0); second.owner.stop()
  })
  it('does not submit if durable storage fails', async () => {
    const f = fixture(); f.storage.setItem = () => { throw Error('disk') }; const p = f.mount()
    expect(await p.attempt.start(payload)).toBe(false); expect(f.request).not.toHaveBeenCalled(); p.owner.stop()
  })
  it('ignores a late success after account switch and retains original actor recovery', async () => {
    const f = fixture(), p = f.mount(); let finish!: (v: unknown) => void
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const running = p.attempt.start(payload); f.actor.value = '8'; f.scope.value = 'session8'; await nextTick(); finish({})
    expect(await running).toBe(false); expect(f.storage.getItem('erp.logistics.transfer.7')).not.toBeNull()
    expect(p.attempt.pending.value).toBeNull(); p.owner.stop()
  })
  it('freezes new operations while uncertain or permission is revoked', async () => {
    const f = fixture(), p = f.mount(); f.request.mockRejectedValue(new Error('lost'))
    await p.attempt.start(payload); await p.attempt.start({ ...payload, qty: 4 }); expect(f.request).toHaveBeenCalledTimes(1)
    f.allowed.value = false; expect(await p.attempt.resume()).toBe(false); expect(f.request).toHaveBeenCalledTimes(1); p.owner.stop()
  })
})
