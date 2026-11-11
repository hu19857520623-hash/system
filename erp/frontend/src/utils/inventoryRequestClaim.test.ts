import { describe, expect, it, vi } from 'vitest'
import { claimInventoryRequest, type InventoryClaimLock } from './inventoryRequestClaim'

function fixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const queue: Array<() => void> = []
  const lock: InventoryClaimLock = (_name, callback) => new Promise((resolve, reject) => { queue.push(() => { try { resolve(callback()) } catch (e) { reject(e) } }) })
  return { storage, values, queue, lock }
}

describe('cross-page inventory original request claims', () => {
  it('rejects an already queued competing page even when first request finishes and clears recovery before lock release', async () => {
    const f = fixture(), first = vi.fn(() => { f.storage.setItem('erp.inventory.change.7', 'first'); return true }), second = vi.fn(() => true)
    const a = claimInventoryRequest({ actor: '7', storage: f.storage, current: () => true, prepare: first, lock: f.lock })
    const b = claimInventoryRequest({ actor: '7', storage: f.storage, current: () => true, prepare: second, lock: f.lock }).catch(e => e)
    f.queue.shift()!(); expect(await a).toBe(true)
    f.storage.removeItem('erp.inventory.change.7')
    f.queue.shift()!(); expect((await b).message).toContain('另一库存页面')
    expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled()
  })
  it.each(['erp.inventory.adjust.7', 'erp.inventory.change.7', 'erp.logistics.transfer.7'])('does not start a different stock action while %s is unresolved', async key => {
    const f = fixture(), prepare = vi.fn(() => true); f.storage.setItem(key, 'pending')
    const result = claimInventoryRequest({ actor: '7', storage: f.storage, current: () => true, prepare, lock: f.lock }).catch(e => e)
    f.queue.shift()!(); expect((await result).message).toContain('已有库存原请求'); expect(prepare).not.toHaveBeenCalled()
  })
  it('revalidates identity and permission after waiting without creating request data', async () => {
    const f = fixture(); let current = true; const prepare = vi.fn(() => true)
    const result = claimInventoryRequest({ actor: '7', storage: f.storage, current: () => current, prepare, lock: f.lock })
    current = false; f.queue.shift()!(); expect(await result).toBe(false); expect(prepare).not.toHaveBeenCalled(); expect(f.values.size).toBe(0)
  })
  it('keeps accounts separate and allows a new intentional action after prior work has finished', async () => {
    const f = fixture(); f.storage.setItem('erp.inventory.change.8', 'private')
    const make = () => claimInventoryRequest({ actor: '7', storage: f.storage, current: () => true, prepare: () => true, lock: f.lock })
    const a = make(); f.queue.shift()!(); expect(await a).toBe(true)
    const b = make(); f.queue.shift()!(); expect(await b).toBe(true)
    expect(f.storage.getItem('erp.inventory.change.8')).toBe('private')
  })
  it('fails closed when browser locking is unavailable', async () => {
    const f = fixture(), prepare = vi.fn(() => true)
    vi.stubGlobal('navigator', {})
    try { await expect(claimInventoryRequest({ actor: '7', storage: f.storage, current: () => true, prepare })).rejects.toThrow('本次尚未提交') }
    finally { vi.unstubAllGlobals() }
    expect(prepare).not.toHaveBeenCalled(); expect(f.values.size).toBe(0)
  })
  it('serializes competing claims using the runtime native LockManager rather than a mock', async () => {
    const f = fixture(); let release!: () => void, entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    const holder = navigator.locks.request('erp.inventory.original.7', async () => { entered(); await new Promise<void>(resolve => { release = resolve }) })
    await ready
    const first = vi.fn(() => { f.storage.setItem('erp.inventory.change.7', 'first'); return true }), second = vi.fn(() => true)
    const a = claimInventoryRequest({ actor: '7', storage: f.storage, current: () => true, prepare: first })
    const b = claimInventoryRequest({ actor: '7', storage: f.storage, current: () => true, prepare: second }).catch(e => e)
    const state = await navigator.locks.query()
    expect(state.held?.some(lock => lock.name === 'erp.inventory.original.7')).toBe(true)
    expect(state.pending?.filter(lock => lock.name === 'erp.inventory.original.7').length).toBe(2)
    release(); await holder; expect(await a).toBe(true); expect((await b).message).toContain('另一库存页面')
    expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled()
  })

})
