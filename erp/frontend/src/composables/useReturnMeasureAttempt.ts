import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

export type ReturnMeasurement = {
  id: number; returnNo: string; clientRequestId: string; expectedRevision: string
  mode: 'replace' | 'existing'
  cartons: { lengthCm: number; widthCm: number; heightCm: number; grossWeightKg: number }[]
}
export type ReturnMeasureResult = { id: number; outcome: 'applied' | 'closed'; estimatedFeeTotal: number | null }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type ClaimLock = (name: string, work: () => boolean) => Promise<boolean>
const browserLock: ClaimLock = async (name, work) => {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw Error('当前浏览器无法协调多个退件页面，本次尚未提交，请使用支持安全标签页锁的浏览器')
  return navigator.locks.request(name, work)
}

function valid(p: ReturnMeasurement) {
  return p && Number.isSafeInteger(p.id) && p.id > 0 && typeof p.returnNo === 'string' && !!p.returnNo
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.clientRequestId)
    && /^[0-9a-f]{64}$/i.test(p.expectedRevision) && ['replace', 'existing'].includes(p.mode)
    && Array.isArray(p.cartons) && p.cartons.length > 0 && p.cartons.every(c => c
      && [c.lengthCm, c.widthCm, c.heightCm].every(x => Number.isFinite(x) && x > 0)
      && Number.isFinite(c.grossWeightKg) && c.grossWeightKg >= 0)
}

export function useReturnMeasureAttempt(options: {
  actor: () => string; scope: () => string | null; storage: StoragePort; lock?: ClaimLock
  request: (payload: ReturnMeasurement, closeOnly: boolean) => Promise<ReturnMeasureResult>
}) {
  const pending = shallowRef<ReturnMeasurement | null>(null), busy = ref(false), blocked = ref(false), feedback = ref('')
  const key = (actor: string) => `erp.return.measure-fees.${actor}`
  let revision = 0, stopped = false
  const scope = () => { try { return options.scope() } catch { return null } }
  function reload() {
    ++revision
    pending.value = null; busy.value = false; blocked.value = false; feedback.value = ''
    if (!options.actor() || !scope()) return
    try {
      const raw = options.storage.getItem(key(options.actor()))
      if (!raw) return
      const p = JSON.parse(raw)
      if (!valid(p)) throw Error('invalid original measurement')
      pending.value = p
      feedback.value = '原测量与算费结果待核对。请继续原请求，或核对并结束原请求；返回列表会保留原内容。'
    } catch {
      blocked.value = true
      feedback.value = '无法读取原测量请求，请重试读取；仍失败时请联系主管核对退件审计，勿另建测量请求。'
    }
  }
  watch(scope, reload, { immediate: true, flush: 'sync' })
  const changed = (e: StorageEvent) => { if (e.key === null || e.key === key(options.actor())) reload() }
  if (typeof window !== 'undefined') window.addEventListener('storage', changed)
  onScopeDispose(() => { stopped = true; ++revision; busy.value = false; if (typeof window !== 'undefined') window.removeEventListener('storage', changed) })

  async function settle(closeOnly = false): Promise<ReturnMeasureResult | null> {
    if (stopped || busy.value || blocked.value || !pending.value || !scope()) return null
    const actor = options.actor(), identity = scope(), version = revision
    const p = structuredClone(pending.value), raw = JSON.stringify(p)
    const active = () => !stopped && version === revision && actor === options.actor() && identity === scope()
    busy.value = true
    feedback.value = closeOnly ? '正在核对并结束原请求，请稍候。' : '正在核对原测量与算费请求，请稍候。'
    try {
      if (options.storage.getItem(key(actor)) !== raw) { reload(); return null }
      let deadline: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        options.request(p, closeOnly),
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(Error('等待核对结果超时，原请求已保留')), 30000) }),
      ]).finally(() => { if (deadline) clearTimeout(deadline) })
      if (!active()) return null
      if (!result || result.id !== p.id || !['applied', 'closed'].includes(result.outcome)
        || (result.outcome === 'applied' && !Number.isFinite(result.estimatedFeeTotal))) throw Error('原测量回执无法核对，请继续原请求')
      if (options.storage.getItem(key(actor)) !== raw) { reload(); return null }
      options.storage.removeItem(key(actor))
      if (options.storage.getItem(key(actor)) !== null) throw Error('原测量回执未能清理，请继续原请求核对')
      pending.value = null
      feedback.value = result.outcome === 'applied' ? '原请求已确认保存；请读取最新退件，以当前状态继续作业。' : '原请求已结束，尚未执行的测量和算费不会再提交。请读取最新退件后继续。'
      return result
    } catch (e) {
      if (active()) feedback.value = `原请求已保留。${userFacingError(e)} 请继续原请求或核对并结束，勿另建测量请求。`
      return null
    } finally {
      if (active()) busy.value = false
      else if (!stopped && version === revision) reload()
    }
  }

  async function start(payload: Omit<ReturnMeasurement, 'clientRequestId'>) {
    if (stopped || busy.value || blocked.value || pending.value || !options.actor() || !scope()) return null
    const actor = options.actor(), identity = scope(), version = revision
    const current = () => !stopped && version === revision && actor === options.actor() && identity === scope()
    busy.value = true
    feedback.value = '正在保存本次测量请求，请稍候。'
    try {
      const intent = structuredClone(payload), epochKey = key(actor) + '.epoch', observed = options.storage.getItem(epochKey)
      const prepared = await (options.lock || browserLock)(`erp.returns.original.${actor}`, () => {
        if (!current()) return false
        if (options.storage.getItem(`erp.returns.original.${actor}`)) { feedback.value = '请先核对并结束待处理的退件原请求'; return false }
        if (options.storage.getItem(key(actor))) { reload(); return false }
        if (options.storage.getItem(epochKey) !== observed) { feedback.value = '另一退件页面已发起操作，请先读取最新退件再继续'; return false }
        const p = { ...intent, clientRequestId: crypto.randomUUID() }
        if (!valid(p)) throw Error('测量资料无效，请重新读取退件并核对外箱尺寸')
        const epoch = crypto.randomUUID(), raw = JSON.stringify(p)
        options.storage.setItem(epochKey, epoch)
        if (options.storage.getItem(epochKey) !== epoch) throw Error('退件页面协调信息无法保存，本次尚未提交')
        options.storage.setItem(key(actor), raw)
        if (options.storage.getItem(key(actor)) !== raw) throw Error('原测量请求无法保存，本次尚未提交')
        pending.value = p
        feedback.value = '本次测量与算费请求已保存，返回列表会保留原内容。'
        return true
      })
      if (!prepared) return null
    } catch (e) {
      if (current()) { blocked.value = true; feedback.value = userFacingError(e, undefined, '无法保存原测量请求，本次尚未提交，请检查存储后重新读取。') }
      return null
    } finally {
      if (current()) busy.value = false
      else if (!stopped && version === revision) reload()
    }
    if (!current()) return null
    return settle()
  }
  return { pending, busy, blocked, feedback, start, resume: () => settle(), close: () => settle(true), reload }
}
