import { ref, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

export type StocktakeAction = 'create' | 'count' | 'approve'
type Attempt = { action: StocktakeAction; requestId: string; payload: Record<string, unknown>; planId?: number; uncertain?: boolean }
type Options = {
  owner: () => string
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  send: (attempt: Attempt) => Promise<any>
  lookup: (key: string) => Promise<{ found: boolean; action?: string; plan?: any }>
  applied: (action: StocktakeAction, plan: any) => void
  newId?: () => string
}

/** A pending request survives navigation/reload and is always retried with its original identity and body. */
export function createStocktakeAction(options: Options) {
  const pending = ref<Attempt | null>(null), busy = ref(false), feedback = ref('')
  let owner = options.owner(), revision = 0
  const key = () => `erp.stocktake.pending.${owner}`
  function restore() {
    pending.value = null
    try {
      const value = JSON.parse(options.storage.getItem(key()) || 'null')
      if (value && ['create', 'count', 'approve'].includes(value.action) && /^[A-Za-z0-9_-]{8,100}$/.test(value.requestId) && value.payload && typeof value.payload === 'object') {
        pending.value = { ...value, uncertain: true }
        feedback.value = '上次盘点提交的结果尚待核对，请核对后继续。'
      }
    } catch { feedback.value = '未能读取上次提交记录，请核对盘点列表后继续。' }
  }
  restore()
  const unwatch = watch(options.owner, value => { ++revision; owner = value; busy.value = false; feedback.value = ''; restore() })
  function complete(attempt: Attempt, plan: any) {
    pending.value = null
    try { options.storage.removeItem(key()) } catch { /* Recovered receipts remain safe to query again. */ }
    feedback.value = { create: '盘点任务已创建，已读取最新结果。', count: '本次实盘数量已提交，已读取最新结果。', approve: '盘点审批已完成，已读取最新结果。' }[attempt.action]
    try { options.applied(attempt.action, plan) }
    catch { feedback.value = '本次提交已完成，但页面未能显示最新结果。请刷新盘点列表核对，请勿重复提交。' }
  }
  async function retry() {
    if (busy.value || !pending.value) return
    const attempt = JSON.parse(JSON.stringify(pending.value)) as Attempt, actor = owner, sequence = ++revision
    busy.value = true
    try {
      const plan = await options.send(attempt)
      if (actor === options.owner() && sequence === revision) complete(attempt, plan)
    } catch (error) {
      if (actor !== options.owner() || sequence !== revision) return
      const status = (error as { status?: number })?.status
      if (!attempt.uncertain && [400, 403, 409, 422].includes(status || 0)) {
        pending.value = null
        try { options.storage.removeItem(key()) } catch { /* A later receipt check will be safe. */ }
        feedback.value = `${userFacingError(error)} 请刷新盘点结果后核对再操作。`
      } else {
        if (pending.value) {
          pending.value.uncertain = true
          try { options.storage.setItem(key(), JSON.stringify(pending.value)) } catch { /* The original persisted request already supports recovery. */ }
        }
        feedback.value = `提交结果尚未确认。${userFacingError(error)} 请先核对结果；重试将使用同一份提交。`
      }
    } finally { if (sequence === revision) busy.value = false }
  }
  async function start(action: StocktakeAction, payload: Record<string, unknown>, planId?: number) {
    if (busy.value || pending.value) return
    const attempt = { action, payload: JSON.parse(JSON.stringify(payload)), planId, requestId: options.newId?.() || crypto.randomUUID() }
    try { options.storage.setItem(key(), JSON.stringify(attempt)) }
    catch { feedback.value = '浏览器未能保存提交恢复记录，本次尚未提交。请检查浏览器存储后重试。'; return }
    pending.value = attempt
    feedback.value = ''
    await retry()
  }
  async function reconcile() {
    if (busy.value || !pending.value) return
    const attempt = pending.value, actor = owner, sequence = ++revision
    busy.value = true
    try {
      const result = await options.lookup(attempt.requestId)
      if (actor !== options.owner() || sequence !== revision) return
      if (result.found && result.action === attempt.action && result.plan) complete(attempt, result.plan)
      else feedback.value = '暂未查到这次提交的完成记录，可重试原提交；请勿重新创建相同任务。'
    } catch (error) {
      if (actor === options.owner() && sequence === revision) feedback.value = `核对结果失败。${userFacingError(error)} 请保留当前提交并稍后重试核对。`
    } finally { if (sequence === revision) busy.value = false }
  }
  function clearFeedback() { if (!pending.value && !busy.value) feedback.value = '' }
  return { pending, busy, feedback, start, retry, reconcile, clearFeedback, stop: () => { ++revision; unwatch() } }
}
