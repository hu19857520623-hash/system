import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

export type InventoryChange = { clientRequestId: string; kind: 'single' | 'batch'; payload: Record<string, any> }
export function useInventoryChangeAttempt(options: {
  actor: () => string; scope: () => string | null; allowed: () => boolean
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  request: (payload: InventoryChange) => Promise<unknown>
  closeRequest?: (payload: InventoryChange) => Promise<{ status: string; clientRequestId: string; appliedIndices: number[]; unappliedIndices: number[]; total: number }>
}) {
  const pending = shallowRef<InventoryChange | null>(null), busy = ref(false), feedback = ref(''), blocked = ref(false)
  const key = (actor: string) => `erp.inventory.change.${actor}`
  let revision = 0, stopped = false
  function restore() {
    pending.value = null; busy.value = false; blocked.value = false; feedback.value = ''
    if (!options.actor() || !options.scope()) return
    try {
      const raw = options.storage.getItem(key(options.actor())); if (!raw) return
      const p = JSON.parse(raw)
      if (!p || !/^[0-9a-f-]{36}$/i.test(p.clientRequestId) || !['single', 'batch'].includes(p.kind) || !p.payload || typeof p.payload !== 'object' || (p.kind === 'batch' && (!Array.isArray(p.payload.rows) || !p.payload.rows.length))) throw Error()
      pending.value = p; feedback.value = '原库存变更结果待核对。请继续原请求，服务器会返回原回执，勿重新创建库存变更。'
    } catch { blocked.value = true; feedback.value = '原库存变更信息无法读取，请联系主管核对库存流水，勿重复库存变更。' }
  }
  watch(options.scope, () => { ++revision; restore() }, { immediate: true, flush: 'sync' })
  const changed = (event: StorageEvent) => { if (event.key === null || event.key === key(options.actor())) { ++revision; restore() } }
  if (typeof window !== 'undefined') window.addEventListener('storage', changed)
  onScopeDispose(() => { stopped = true; ++revision; if (typeof window !== 'undefined') window.removeEventListener('storage', changed) })
  async function run(mode: 'submit' | 'close') {
    if (stopped || busy.value || blocked.value || !pending.value || !options.scope() || !options.allowed()) return false
    if (mode === 'close' && (pending.value.kind !== 'batch' || !options.closeRequest)) return false
    const actor = options.actor(), scope = options.scope(), p = pending.value, raw = JSON.stringify(p), version = revision
    const active = () => !stopped && version === revision && actor === options.actor() && scope === options.scope()
    busy.value = true
    try {
      if (options.storage.getItem(key(actor)) !== raw) { ++revision; restore(); return false }
      const receipt = mode === 'close' ? await options.closeRequest!(structuredClone(p)) : await options.request(structuredClone(p))
      if (mode === 'close') {
        const closed = receipt as any
        if (closed?.status !== 'closed' || closed.clientRequestId !== p.clientRequestId || closed.total !== p.payload.rows.length || !Array.isArray(closed.unappliedIndices) || !Array.isArray(closed.appliedIndices) || [...closed.unappliedIndices, ...closed.appliedIndices].some((i: number) => !Number.isInteger(i) || i < 0 || i >= closed.total) || closed.unappliedIndices.length + closed.appliedIndices.length !== closed.total || new Set([...closed.unappliedIndices, ...closed.appliedIndices]).size !== closed.total) throw new Error('结束回执不完整，原批次仍保留，请核对后重试')
      }
      if (!active()) return false
      if (options.storage.getItem(key(actor)) !== raw) { ++revision; restore(); return false }
      options.storage.removeItem(key(actor))
      if (options.storage.getItem(key(actor)) !== null) throw Error('原库存变更回执未清理，请核对后继续')
      pending.value = null; feedback.value = mode === 'close' ? '原批次已结束，已成功行保留，未成功行可修正后新建批次。' : '原库存变更已确认成功，可查看库存流水或继续其它作业。'; return mode === 'close' ? receipt as { status: string; clientRequestId: string; appliedIndices: number[]; unappliedIndices: number[]; total: number } : true
    } catch (e) { if (active()) feedback.value = `原库存变更已保留。${userFacingError(e)} 请继续原请求或返回后核对。`; return false }
    finally { if (active()) busy.value = false }
  }
  async function start(payload: Omit<InventoryChange, 'clientRequestId'>) {
    if (stopped || busy.value || blocked.value || pending.value || !options.actor() || !options.scope() || !options.allowed()) return false
    try {
      if (options.storage.getItem(key(options.actor()))) { restore(); return false }
      const p = { ...structuredClone(payload), clientRequestId: crypto.randomUUID() }, raw = JSON.stringify(p)
      options.storage.setItem(key(options.actor()), raw)
      if (options.storage.getItem(key(options.actor())) !== raw) throw Error()
      pending.value = p
    } catch { blocked.value = true; feedback.value = '无法保存原库存变更信息，本次尚未提交，请检查存储后重试。'; return false }
    return run('submit')
  }
  return { pending, busy, blocked, feedback, start, resume: () => run('submit'), closeBatch: () => run('close') }
}
