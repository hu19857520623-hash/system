import { claimInventoryRequest, InventoryClaimConflict, type InventoryClaimLock } from './inventoryRequestClaim'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

export type TransferPayload = { clientRequestId: string; sku: string; fromWarehouseCode: string; toWarehouseCode: string; qty: number; remark?: string }
export function useLogisticsTransferAttempt(options: {
  claimLock?: InventoryClaimLock
  actor: () => string; scope: () => string | null; allowed: () => boolean
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  request: (payload: TransferPayload) => Promise<unknown>
}) {
  const pending = shallowRef<TransferPayload | null>(null), busy = ref(false), feedback = ref(''), blocked = ref(false)
  const key = (actor: string) => `erp.logistics.transfer.${actor}`
  let revision = 0, stopped = false
  function restore() {
    pending.value = null; busy.value = false; blocked.value = false; feedback.value = ''
    if (!options.actor() || !options.scope()) return
    try {
      const raw = options.storage.getItem(key(options.actor())); if (!raw) return
      const p = JSON.parse(raw)
      if (!p || !/^[0-9a-f-]{36}$/i.test(p.clientRequestId) || typeof p.sku !== 'string' || !p.sku || !p.fromWarehouseCode || !p.toWarehouseCode || p.fromWarehouseCode === p.toWarehouseCode || !Number.isSafeInteger(p.qty) || p.qty < 1) throw Error()
      pending.value = p; feedback.value = '原调拨结果待核对。请继续原请求，服务器会返回原回执，勿重新创建调拨。'
    } catch { blocked.value = true; feedback.value = '原调拨信息无法读取，请联系主管核对库存流水，勿重复调拨。' }
  }
  watch(options.scope, () => { ++revision; restore() }, { immediate: true, flush: 'sync' })
  const changed = (event: StorageEvent) => { if (event.key === null || event.key === key(options.actor())) { ++revision; restore() } }
  if (typeof window !== 'undefined') window.addEventListener('storage', changed)
  onScopeDispose(() => { stopped = true; ++revision; if (typeof window !== 'undefined') window.removeEventListener('storage', changed) })
  async function resume() {
    if (stopped || busy.value || blocked.value || !pending.value || !options.scope() || !options.allowed()) return false
    const actor = options.actor(), scope = options.scope(), p = pending.value, raw = JSON.stringify(p), version = revision
    const active = () => !stopped && version === revision && actor === options.actor() && scope === options.scope()
    busy.value = true
    try {
      if (options.storage.getItem(key(actor)) !== raw) { ++revision; restore(); return false }
      await options.request(structuredClone(p))
      if (!active()) return false
      if (options.storage.getItem(key(actor)) !== raw) { ++revision; restore(); return false }
      options.storage.removeItem(key(actor))
      if (options.storage.getItem(key(actor)) !== null) throw Error('原调拨回执未清理，请核对后继续')
      pending.value = null; feedback.value = '原调拨已确认成功，可查看库存流水或继续其它作业。'; return true
    } catch (e) { if (active()) feedback.value = `原调拨已保留。${userFacingError(e)} 请继续原请求或返回后核对。`; return false }
    finally { if (active()) busy.value = false }
  }
  async function start(payload: Omit<TransferPayload, 'clientRequestId'>) {
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
    } catch (error) { if (stopped || version !== revision || actor !== options.actor() || scope !== options.scope()) return false; blocked.value = !(error instanceof InventoryClaimConflict); feedback.value = userFacingError(error, undefined, '无法保存原调拨信息，本次尚未提交，请检查存储后重试。'); return false }
    return resume()
  }
  return { pending, busy, blocked, feedback, start, resume }
}
