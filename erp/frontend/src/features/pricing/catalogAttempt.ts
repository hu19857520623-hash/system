import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

export type CatalogAction = 'confirm' | 'sync' | 'share'
export type CatalogAttempt = { actor: string; requestId: string; pricingId: number; name: string; action: CatalogAction; payload: Record<string, unknown> }
type Receipt = { requestId: string; pricingId: number; action: CatalogAction; status: 'unknown' | 'confirmed' | 'cancelled'; version?: string; price?: number; pricingStatus?: string; shareStatus?: string }
export const catalogActionLabel = { confirm: '确认定价', sync: '同步OMS', share: '变更共享' }

export function useCatalogAttempt(options: {
 actor: () => string; scope: () => string | null; allowed: (action: CatalogAction) => boolean
 conflict: () => boolean; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
 request: (mode: 'submit' | 'check' | 'cancel', attempt: CatalogAttempt) => Promise<Receipt>
 applied: (attempt: CatalogAttempt, receipt: Receipt, active: () => boolean) => Promise<void>
}) {
 const pending = shallowRef<CatalogAttempt | null>(null), busy = ref(false), feedback = ref(''), blocked = ref(false)
 const key = (actor: string) => `erp.pricing.action.${actor}`
 let revision = 0, stopped = false
 function valid(a: CatalogAttempt, actor: string) {
  return a && a.actor === actor && Number.isSafeInteger(a.pricingId) && a.pricingId > 0 && typeof a.name === 'string'
   && ['confirm', 'sync', 'share'].includes(a.action) && a.payload && typeof a.payload === 'object'
   && typeof a.payload.expectedUpdatedAt === 'string' && Number.isFinite(Date.parse(a.payload.expectedUpdatedAt))
   && typeof a.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.requestId)
   && (a.action !== 'confirm' || typeof a.payload.finalPrice === 'number' && Number.isFinite(a.payload.finalPrice) && a.payload.finalPrice > 0 && typeof a.payload.marketPrice === 'number' && Number.isFinite(a.payload.marketPrice) && a.payload.marketPrice > 0)
   && (a.action !== 'share' || ['enabled', 'stopped'].includes(String(a.payload.status)))
 }
 function restore() {
  pending.value = null; busy.value = false; blocked.value = false; feedback.value = ''
  const actor = options.actor(); if (!actor || !options.scope()) return
  try {
   const raw = options.storage.getItem(key(actor)); if (!raw) return
   const a = JSON.parse(raw) as CatalogAttempt; if (!valid(a, actor)) throw Error()
   pending.value = a; feedback.value = `原${catalogActionLabel[a.action]}结果待核对，请核对、继续或取消原请求，勿重新提交。`
  } catch { blocked.value = true; feedback.value = '原货盘操作信息无法读取，请联系管理员核对，勿重新提交。' }
 }
 const stopWatch = watch(options.scope, () => { ++revision; restore() }, { immediate: true, flush: 'sync' })
 const storageChanged = (event: StorageEvent) => { if (event.key === null || event.key === key(options.actor())) { ++revision; restore() } }
 if (typeof window !== 'undefined') window.addEventListener('storage', storageChanged)
 onScopeDispose(() => { stopped = true; ++revision; stopWatch(); if (typeof window !== 'undefined') window.removeEventListener('storage', storageChanged) })
 async function run(mode: 'submit' | 'check' | 'cancel'): Promise<boolean> {
  const a = pending.value, owner = options.scope(), version = revision
  if (stopped || !a || busy.value || blocked.value || !owner || a.actor !== options.actor()) return false
  if (!options.allowed(a.action)) { feedback.value = '当前权限不足，请使用原账号恢复相应权限后核对原请求。'; return false }
  const active = () => !stopped && revision === version && owner === options.scope() && a.actor === options.actor() && options.allowed(a.action)
  busy.value = true; feedback.value = '正在核对原货盘操作结果…'
  try {
   if (mode === 'submit' && options.conflict()) throw Error('请先核对或取消其它待处理操作，再继续原请求')
   const raw = options.storage.getItem(key(a.actor))
   if (!raw || JSON.stringify(JSON.parse(raw)) !== JSON.stringify(a)) throw Error('本地原操作记录已变化，请重新加载页面核对')
   const result = await options.request(mode, structuredClone(a)); if (!active()) return false
   if (result?.requestId !== a.requestId || result.pricingId !== a.pricingId || result.action !== a.action || !['unknown', 'confirmed', 'cancelled'].includes(result.status)
    || result.status === 'confirmed' && (typeof result.version !== 'string' || !Number.isFinite(Date.parse(result.version)) || !Number.isFinite(result.price) || Number(result.price) <= 0 || !['priced', 'synced'].includes(result.pricingStatus || '') || !['enabled', 'stopped'].includes(result.shareStatus || ''))) throw Error('原操作回执不完整，请保留原请求继续核对')
   if (result.status === 'unknown') { feedback.value = '尚未查到原操作结果，请继续原请求或取消原请求，勿重新创建。'; return false }
   // A confirmed receipt describes the original outcome; reload current data before releasing it.
   // Cancellation needs no detail read, so deleted products cannot trap a cancelled request.
   if (result.status === 'confirmed') await options.applied(a, result, active)
   if (!active()) return false
   if (options.storage.getItem(key(a.actor)) !== raw) throw Error('本地原操作记录已变化，请重新加载页面核对')
   options.storage.removeItem(key(a.actor)); pending.value = null
   feedback.value = result.status === 'cancelled' ? '原货盘操作请求已取消，请读取最新资料后继续。' : '原货盘操作结果已确认，列表显示当前最新资料，请核对后继续。'
   return true
  } catch (error) { if (active()) feedback.value = `原货盘操作已保留。${userFacingError(error)} 请核对结果、继续或取消原请求。`; return false }
  finally { if (active()) busy.value = false }
 }
 async function start(action: CatalogAction, pricingId: number, name: string, payload: Record<string, unknown>) {
  if (stopped || busy.value || pending.value || blocked.value || !options.scope() || !options.allowed(action)) return false
  const actor = options.actor(), attempt = { actor, requestId: crypto.randomUUID(), pricingId, name, action, payload: structuredClone(payload) }
  if (!valid(attempt, actor)) { feedback.value = '商品资料不完整，本次尚未提交，请读取最新资料后继续。'; return false }
  try {
   if (options.conflict()) { feedback.value = '请先核对其它待处理操作，本次尚未提交。'; return false }
   if (options.storage.getItem(key(actor))) { restore(); return false }
   const raw = JSON.stringify(attempt); options.storage.setItem(key(actor), raw)
   if (options.storage.getItem(key(actor)) !== raw) throw Error()
  } catch { feedback.value = '无法保存原操作信息，本次尚未提交，请检查浏览器存储后重试。'; return false }
  pending.value = attempt; return run('submit')
 }
 return { pending, busy, feedback, blocked, start, run }
}
