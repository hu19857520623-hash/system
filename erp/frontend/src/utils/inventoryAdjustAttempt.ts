import { claimInventoryRequest, InventoryClaimConflict, type InventoryClaimLock } from './inventoryRequestClaim'
import { inventoryContentMismatch, inventoryPendingNotice, inventoryRequestFinished } from './inventoryLocationChange'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

export type InventoryAdjustment = { clientRequestId: string; id: number; qty: number; locationCode: string; customerCode: string; remark?: string; contentChanged?: boolean }
export function useInventoryAdjustAttempt(options: {
  claimLock?: InventoryClaimLock
  actor: () => string; scope: () => string | null; allowed: () => boolean
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  request: (payload: InventoryAdjustment) => Promise<unknown>
}) {
  const pending = shallowRef<InventoryAdjustment | null>(null), busy = ref(false), feedback = ref(''), blocked = ref(false)
  const key = (actor: string) => `erp.inventory.adjust.${actor}`
  let revision = 0, stopped = false
  function restore() {
    pending.value = null; busy.value = false; blocked.value = false; feedback.value = ''
    if (!options.actor() || !options.scope()) return
    try {
      const raw = options.storage.getItem(key(options.actor())); if (!raw) return
      const p = JSON.parse(raw)
      if (!p || !/^[0-9a-f-]{36}$/i.test(p.clientRequestId) || !Number.isSafeInteger(p.id) || p.id < 1 || !p.locationCode || !p.customerCode || !Number.isSafeInteger(p.qty) || p.qty < 0) throw Error()
      if (p.contentChanged !== true) delete p.contentChanged
      pending.value = p; feedback.value = inventoryPendingNotice('库存调整', p.contentChanged)
    } catch { blocked.value = true; feedback.value = '原库存调整信息无法读取，请联系主管核对库存流水，勿重复库存调整。' }
  }
  watch(options.scope, () => { ++revision; restore() }, { immediate: true, flush: 'sync' })
  const changed = (event: StorageEvent) => { if (event.key === null || event.key === key(options.actor())) { ++revision; restore() } }
  if (typeof window !== 'undefined') window.addEventListener('storage', changed)
  onScopeDispose(() => { stopped = true; ++revision; if (typeof window !== 'undefined') window.removeEventListener('storage', changed) })
  async function resume() {
    if (stopped || busy.value || blocked.value || !pending.value || !options.scope() || !options.allowed()) return false
    if (pending.value.contentChanged) return false
    const actor = options.actor(), scope = options.scope(), p = pending.value, raw = JSON.stringify(p), version = revision
    const active = () => !stopped && version === revision && actor === options.actor() && scope === options.scope()
    busy.value = true
    try {
      if (options.storage.getItem(key(actor)) !== raw) { ++revision; restore(); return false }
      await options.request(structuredClone(p))
      if (!active()) return false
      if (options.storage.getItem(key(actor)) !== raw) { ++revision; restore(); return false }
      options.storage.removeItem(key(actor))
      if (options.storage.getItem(key(actor)) !== null) throw Error('原库存调整回执未清理，请核对后继续')
      pending.value = null; feedback.value = '原库存调整已确认成功，可查看库存流水或继续其它作业。'; return true
    } catch (e) {
      if (!active()) return false
      const text = userFacingError(e)
      if (inventoryContentMismatch(text)) {
        const next = { ...p, contentChanged: true as const }
        options.storage.setItem(key(actor), JSON.stringify(next))
        pending.value = next
        feedback.value = `${inventoryPendingNotice('库存调整', true)}${text}`
        return false
      }
      if (inventoryRequestFinished(text)) {
        options.storage.removeItem(key(actor))
        pending.value = null
        feedback.value = `${text}。请按最新库存重新填写，不要继续原请求。`
        return false
      }
      feedback.value = `原库存调整已保留。${text} 请继续原请求或返回后核对。`
      return false
    }
    finally { if (active()) busy.value = false }
  }
  async function start(payload: Omit<InventoryAdjustment, 'clientRequestId'>) {
    if (stopped || busy.value || blocked.value || pending.value || !options.actor() || !options.scope() || !options.allowed()) return false
    const actor = options.actor(), scope = options.scope(), version = revision
    try {
      const intent = structuredClone(payload)
      const prepared = await claimInventoryRequest({ actor, storage: options.storage, lock: options.claimLock, current: () => !stopped && version === revision && actor === options.actor() && scope === options.scope() && options.allowed(), prepare: () => {
        if (options.storage.getItem(key(options.actor()))) { restore(); return false }
        const p = { ...intent, clientRequestId: crypto.randomUUID() }, raw = JSON.stringify(p)
        options.storage.setItem(key(options.actor()), raw)
        if (options.storage.getItem(key(options.actor())) !== raw) throw Error()
        pending.value = p
        return true
      } })
      if (!prepared) return false
    } catch (error) { if (stopped || version !== revision || actor !== options.actor() || scope !== options.scope()) return false; blocked.value = !(error instanceof InventoryClaimConflict); feedback.value = userFacingError(error, undefined, '无法保存原库存调整信息，本次尚未提交，请检查存储后重试。'); return false }
    return resume()
  }
  function endChanged() {
    if (stopped || busy.value || !pending.value?.contentChanged) return false
    options.storage.removeItem(key(options.actor()))
    pending.value = null
    feedback.value = '已结束这次未能入账的库存调整。请先核对库存流水；若没有入账，可以重新填写。'
    return true
  }
  return { pending, busy, blocked, feedback, start, resume, endChanged }
}
