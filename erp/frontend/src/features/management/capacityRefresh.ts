import { ref, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

type Attempt = { requestId: string; warehouseCode?: string; uncertain?: boolean }
export function createCapacityRefresh(options: {
  owner: () => string
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  send: (attempt: Attempt) => Promise<any>
  lookup: (requestId: string) => Promise<{ found: boolean; result?: any }>
  applied: (result: any) => void
  newId?: () => string
}) {
  const pending = ref<Attempt | null>(null), busy = ref(false), feedback = ref('')
  let owner = options.owner(), revision = 0
  const key = () => `erp.capacity.refresh.${owner}`
  function restore() {
    pending.value = null
    try {
      const value = JSON.parse(options.storage.getItem(key()) || 'null')
      if (value && /^[A-Za-z0-9_-]{8,100}$/.test(value.requestId) && (value.warehouseCode === undefined || typeof value.warehouseCode === 'string')) {
        pending.value = { ...value, uncertain: true }; feedback.value = '上次刷新结果尚待核对，请保留原请求后继续。'
      }
    } catch { feedback.value = '未能读取上次刷新记录，请查询容量并核对后继续。' }
  }
  restore()
  const stopWatch = watch(options.owner, value => { ++revision; owner = value; busy.value = false; feedback.value = ''; restore() })
  function complete(result: any) {
    pending.value = null
    try { options.storage.removeItem(key()) } catch { /* The same receipt is safe to recover again. */ }
    feedback.value = `${result.scopeLabel || '原范围'}预警已刷新，共${result.refreshed}条。`
    if (result.checkedAt) feedback.value += `完成于${new Date(result.checkedAt).toLocaleString('zh-CN', { hour12: false })}。`
    try { options.applied(result) } catch { feedback.value += ' 页面未能显示最新容量，请重新查询。' }
  }
  async function retry() {
    if (busy.value || !pending.value) return
    const attempt = { ...pending.value }, actor = owner, sequence = ++revision
    busy.value = true
    try {
      const result = await options.send(attempt)
      if (sequence === revision && actor === options.owner()) complete(result)
    } catch (error) {
      if (sequence !== revision || actor !== options.owner()) return
      if (!attempt.uncertain && [400, 403, 409, 422].includes((error as { status?: number })?.status || 0)) {
        pending.value = null
        try { options.storage.removeItem(key()) } catch { /* A later recovery still uses the original identity. */ }
        feedback.value = `${userFacingError(error)} 请查询容量后核对。`
      } else {
        if (pending.value) { pending.value.uncertain = true; try { options.storage.setItem(key(), JSON.stringify(pending.value)) } catch { /* Original attempt was persisted before sending. */ } }
        feedback.value = `刷新结果尚未确认。${userFacingError(error)} 请核对结果，重试仍使用原仓库范围。`
      }
    } finally { if (sequence === revision) busy.value = false }
  }
  async function start(warehouseCode?: string) {
    if (busy.value || pending.value) return
    const attempt = { requestId: options.newId?.() || crypto.randomUUID(), ...(warehouseCode ? { warehouseCode } : {}) }
    try { options.storage.setItem(key(), JSON.stringify(attempt)) }
    catch { feedback.value = '浏览器无法保存刷新恢复记录，本次尚未提交，请检查存储后重试。'; return }
    pending.value = attempt; feedback.value = ''; await retry()
  }
  async function reconcile() {
    if (busy.value || !pending.value) return
    const requestId = pending.value.requestId, actor = owner, sequence = ++revision
    busy.value = true
    try {
      const result = await options.lookup(requestId)
      if (sequence !== revision || actor !== options.owner()) return
      if (result.found && result.result) complete(result.result)
      else feedback.value = '暂未查到原刷新完成记录，可重试原刷新，请勿重新发起相同操作。'
    } catch (error) {
      if (sequence === revision && actor === options.owner()) feedback.value = `核对刷新结果失败。${userFacingError(error)} 请保留原请求后重试核对。`
    } finally { if (sequence === revision) busy.value = false }
  }
  return { pending, busy, feedback, start, retry, reconcile, stop: () => { ++revision; stopWatch() } }
}
