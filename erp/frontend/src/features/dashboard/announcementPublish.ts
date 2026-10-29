import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

type Attempt = { requestId: string; actor: string; payload: Record<string, unknown> }
type Receipt = { requestId: string; status: 'unknown' | 'confirmed' | 'cancelled'; announcementId?: number; syncPending?: boolean }
export function useAnnouncementPublish(options: {
  actor: () => string; scope: () => string | null
  storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>
  request: (mode: 'submit'|'check'|'cancel', attempt: Attempt) => Promise<Receipt>
  applied: () => Promise<unknown>
}) {
  const pending = shallowRef<Attempt|null>(null), busy = ref(false), feedback = ref(''), blocked = ref(false)
  let revision = 0, stopped = false
  const key = (actor: string) => `erp.announcement.publish.${actor}`
  function restore() {
    pending.value = null; blocked.value = false; feedback.value = ''; busy.value = false
    const actor = options.actor(); if (!actor || !options.scope()) return
    try {
      const raw = options.storage.getItem(key(actor)); if (!raw) return
      const a = JSON.parse(raw) as Attempt
      if (a.actor !== actor || !/^[a-f0-9-]{36}$/i.test(a.requestId) || !a.payload || typeof a.payload.title !== 'string' || typeof a.payload.content !== 'string') throw Error()
      pending.value = a; feedback.value = '有原公告发布结果待核对，请继续原发布或取消原请求，勿重新发布。'
    } catch { blocked.value = true; feedback.value = '原公告发布信息无法读取，请联系管理员核对，勿重新发布。' }
  }
  const stopWatch = watch(options.scope, () => { ++revision; restore() }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { stopped = true; ++revision; stopWatch() })
  async function run(mode: 'submit'|'check'|'cancel') {
    const a = pending.value, scope = options.scope(), version = revision
    if (!a || busy.value || !scope || a.actor !== options.actor() || blocked.value) return
    busy.value = true; feedback.value = '正在核对原公告发布结果…'
    const active = () => !stopped && version === revision && scope === options.scope() && a.actor === options.actor()
    try {
      const result = await options.request(mode, structuredClone(a))
      if (!active()) return
      if (result?.requestId !== a.requestId || !['unknown','confirmed','cancelled'].includes(result.status) || result.status === 'confirmed' && (!Number.isSafeInteger(result.announcementId) || result.announcementId! <= 0)) throw Error('原公告发布回执不完整，请继续核对')
      if (result.status === 'unknown') { feedback.value = '尚未查到原发布结果，请继续原发布或取消原请求，勿重新创建。'; return }
      if (result.status === 'confirmed' && result.syncPending) { feedback.value = `公告${result.announcementId}已保存，OMS推送尚待核对；请继续原发布重试推送，勿重新发布。`; return }
      await options.applied(); if (!active()) return
      const raw = options.storage.getItem(key(a.actor)); if (!raw || JSON.parse(raw).requestId !== a.requestId) throw Error('本地原发布记录已变化，请重新加载工作台核对')
      options.storage.removeItem(key(a.actor)); pending.value = null
      feedback.value = result.status === 'cancelled' ? '原公告发布请求已取消，可核对资料后重新发布。' : `原公告发布已确认，公告编号${result.announcementId}；请按列表最新状态继续。`
    } catch (cause) { if (active()) feedback.value = `原公告发布已保留。${userFacingError(cause)} 请核对结果、继续原发布或取消原请求。` }
    finally { if (active()) busy.value = false }
  }
  async function start(payload: Record<string, unknown>) {
    if (busy.value || pending.value || blocked.value || !options.scope()) return
    const actor = options.actor(), a = { requestId: crypto.randomUUID(), actor, payload: structuredClone(payload) }
    try {
      if (options.storage.getItem(key(actor))) { restore(); return }
      const raw = JSON.stringify(a); options.storage.setItem(key(actor),raw)
      if (options.storage.getItem(key(actor)) !== raw) throw Error()
    } catch { feedback.value = '无法保存公告发布核对信息，本次尚未提交，请检查浏览器存储后重试。'; return }
    pending.value = a; await run('submit')
  }
  return { pending, busy, feedback, blocked, start, run }
}
