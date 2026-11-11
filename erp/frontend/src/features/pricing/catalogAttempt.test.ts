import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCatalogAttempt, type CatalogAction } from './catalogAttempt'
const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(fn => fn()); vi.restoreAllMocks() })
function fixture() {
 const rows = new Map<string, string>(), storage = { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v) }, removeItem: (k: string) => { rows.delete(k) } }
 const owner = ref<string | null>('scope7'), actor = ref('7'), allowed = ref(true), conflict = ref(false), request = vi.fn(), applied = vi.fn(async () => {}), scope = effectScope()
 const control = scope.run(() => useCatalogAttempt({ actor: () => actor.value, scope: () => owner.value, allowed: () => allowed.value, conflict: () => conflict.value, storage, request, applied }))!
 stops.push(() => scope.stop()); return { ...control, rows, storage, owner, actor, allowed, conflict, request, applied, stop: () => scope.stop() }
}
const payload = { finalPrice: 20, marketPrice: 30, status: 'stopped', expectedUpdatedAt: '2026-10-30T00:00:00.000Z' }
const receipt = (id: string, action: CatalogAction) => ({ requestId: id, status: 'confirmed', pricingId: 9, action, price: 20, version: '2026-10-30T00:00:01.000Z', pricingStatus: action === 'confirm' ? 'priced' : 'synced', shareStatus: 'stopped' })
describe('货盘操作原请求恢复', () => {
 it.each(['confirm', 'sync', 'share'] as const)('%s 持久化后才提交；英文故障保留冻结内容，重试不创建新请求', async action => {
  const f = fixture(); f.request.mockImplementationOnce(async (_mode, a) => { expect(JSON.parse([...f.rows.values()][0])).toEqual(a); throw Error('NetworkError') })
  expect(await f.start(action, 9, '商品', payload)).toBe(false); const original = f.pending.value!
  expect(f.feedback.value).not.toContain('NetworkError'); f.owner.value = 'same actor refreshed'; expect(f.pending.value).toEqual(original)
  f.request.mockResolvedValueOnce(receipt(original.requestId, action)); expect(await f.run('submit')).toBe(true)
  expect(f.request.mock.calls[1][1]).toEqual(original); expect(f.applied).toHaveBeenCalledOnce(); expect(f.rows.size).toBe(0)
 })
 it('未知和不匹配回执不能释放原单；取消无需读取可能已删除的商品', async () => {
  const f = fixture(); f.request.mockRejectedValueOnce(Error('fetch')); await f.start('confirm', 9, '商品', payload); const id = f.pending.value!.requestId
  for (const result of [{ requestId: id, status: 'unknown', pricingId: 9, action: 'confirm' }, { ...receipt(id, 'confirm'), action: 'sync' }, { ...receipt(id, 'confirm'), requestId: 'other' }, { ...receipt(id, 'confirm'), pricingId: 10 }, { ...receipt(id, 'confirm'), version: 'bad' }, { ...receipt(id, 'confirm'), price: 0 }]) {
   f.request.mockResolvedValueOnce(result); expect(await f.run('check')).toBe(false); expect(f.pending.value).not.toBeNull()
  }
  f.applied.mockRejectedValue(Error('deleted')); f.request.mockResolvedValueOnce({ requestId: id, status: 'cancelled', pricingId: 9, action: 'confirm' })
  expect(await f.run('cancel')).toBe(true); expect(f.applied).not.toHaveBeenCalled(); expect(f.rows.size).toBe(0)
 })
 it('确认后当前资料读取失败仍保留，后续核对可以继续', async () => {
  const f = fixture(); f.request.mockRejectedValueOnce(Error('fetch')); await f.start('sync', 9, '商品', payload); const id = f.pending.value!.requestId
  f.request.mockResolvedValue(receipt(id, 'sync')); f.applied.mockRejectedValueOnce(Error('NetworkError'))
  expect(await f.run('check')).toBe(false); expect(f.pending.value).not.toBeNull(); expect(await f.run('check')).toBe(true)
 })
 it('撤权或离页时迟到回执不能清除持久原单，也不能在离页后新建提交', async () => {
  const f = fixture(); let release!: (v: any) => void; f.request.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const first = f.start('share', 9, '商品', payload), id = f.pending.value!.requestId
  f.allowed.value = false; f.owner.value = 'revoked'; release(receipt(id, 'share')); expect(await first).toBe(false); expect(f.applied).not.toHaveBeenCalled()
  expect(await f.run('cancel')).toBe(false); expect(f.rows.size).toBe(1)
  f.allowed.value = true; f.stop(); expect(await f.run('submit')).toBe(false); expect(await f.start('sync', 10, '其它', payload)).toBe(false); expect(f.request).toHaveBeenCalledOnce()
 })
 it('切换账号期间迟到结果不得清除原账号记录', async () => {
  const f = fixture(); let release!: (v: any) => void; f.request.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const first = f.start('confirm', 9, '商品', payload), id = f.pending.value!.requestId
  f.actor.value = '8'; f.owner.value = 'scope8'; release(receipt(id, 'confirm')); expect(await first).toBe(false)
  expect(f.rows.has('erp.pricing.action.7')).toBe(true); expect(f.pending.value).toBeNull(); expect(f.applied).not.toHaveBeenCalled()
 })
 it('坏存储或落盘失败不能发送新请求', async () => {
  const f = fixture(); f.rows.set('erp.pricing.action.7', '{'); f.owner.value = 'restore'; expect(f.blocked.value).toBe(true)
  await f.start('sync', 9, '商品', payload); expect(f.request).not.toHaveBeenCalled()
  f.rows.clear(); f.owner.value = 'restored'; vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw Error('quota') })
  await f.start('sync', 9, '商品', payload); expect(f.request).not.toHaveBeenCalled(); expect(f.feedback.value).toContain('本次尚未提交')
 })
 it('其它待处理操作阻断新提交和继续，但允许核对、取消原请求', async () => {
  const f = fixture(); f.conflict.value = true; await f.start('sync', 9, '商品', payload); expect(f.request).not.toHaveBeenCalled()
  f.conflict.value = false; f.request.mockRejectedValueOnce(Error('fetch')); await f.start('sync', 9, '商品', payload); const id = f.pending.value!.requestId
  f.conflict.value = true; await f.run('submit'); expect(f.request).toHaveBeenCalledOnce()
  f.request.mockResolvedValueOnce({ requestId: id, status: 'cancelled', pricingId: 9, action: 'sync' }); expect(await f.run('cancel')).toBe(true)
 })
 it('跨标签更换原单或核对期间存储变化不得提交或清除新记录', async () => {
  const f = fixture(); f.request.mockRejectedValueOnce(Error('fetch')); await f.start('share', 9, '商品', payload); const a = f.pending.value!, raw = JSON.stringify(a)
  f.rows.set('erp.pricing.action.7', JSON.stringify({ ...a, name: '替换' })); await f.run('submit'); expect(f.request).toHaveBeenCalledOnce()
  f.rows.set('erp.pricing.action.7', raw); f.request.mockResolvedValueOnce(receipt(a.requestId, 'share')); f.applied.mockImplementationOnce(async () => { f.rows.set('erp.pricing.action.7', 'new') })
  expect(await f.run('check')).toBe(false); expect(f.rows.get('erp.pricing.action.7')).toBe('new')
 })
 it('连点只提交一次，缺少版本或参数时不保存无效原单', async () => {
  const f = fixture(); for (const invalid of [{ ...payload, expectedUpdatedAt: '' }, { ...payload, finalPrice: 0 }]) await f.start('confirm', 9, '商品', invalid)
  expect(f.rows.size).toBe(0); let release!: (v: any) => void; f.request.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const first = f.start('confirm', 9, '商品', payload); await f.run('submit'); await f.start('sync', 10, '其它', payload); expect(f.request).toHaveBeenCalledOnce()
  release(receipt(f.pending.value!.requestId, 'confirm')); expect(await first).toBe(true)
 })
})
