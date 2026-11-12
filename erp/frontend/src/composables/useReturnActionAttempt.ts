import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'
import { returnAttemptMessage, returnAttemptOutcome } from '@/utils/returnAttempt'
export type ReturnAction = 'receive' | 'reReceive' | 'measure' | 'calculateFees' | 'submitInspection' | 'dispose' | 'process'
export type ReturnStep = { action: ReturnAction; body: Record<string, unknown>; clientRequestId: string }
export type ReturnIntent = { id: number; returnNo: string; index: number; steps: ReturnStep[]; contentChanged?: boolean }
type Lock = (name: string, run: () => Promise<unknown>) => Promise<unknown>
export function useReturnActionAttempt(options: {
  actor: () => string; scope: () => string | null; allowed: (action: ReturnAction) => boolean
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; lock?: Lock
  request: (id: number, step: ReturnStep) => Promise<any>
  close?: (id: number, step: ReturnStep) => Promise<{ outcome: string }>
}) {
  const pending = shallowRef<ReturnIntent | null>(null), busy = ref(false), feedback = ref(''), blocked = ref(false)
  let revision = 0, stopped = false
  const key = (actor: string) => `erp.returns.original.${actor}`
  const actions = ['receive', 'reReceive', 'measure', 'calculateFees', 'submitInspection', 'dispose', 'process']
  const lock: Lock = options.lock || (async (name, run) => {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) throw Error('浏览器无法协调退件页面，本次尚未提交，请使用支持标签页锁的浏览器')
    return navigator.locks.request(name, run)
  })
  function restore() {
    pending.value = null; blocked.value = false; feedback.value = ''; busy.value = false
    if (!options.actor() || !options.scope()) return
    try {
      const raw = options.storage.getItem(key(options.actor())); if (!raw) return
      const value = JSON.parse(raw)
      if (!Number.isSafeInteger(value.id) || value.id < 1 || !value.returnNo || !Array.isArray(value.steps) || !value.steps.length || !Number.isInteger(value.index) || value.index < 0 || value.index >= value.steps.length || !value.steps.every((step: ReturnStep) => actions.includes(step.action) && /^[0-9a-f-]{36}$/i.test(step.clientRequestId) && step.body && typeof step.body === 'object' && !Array.isArray(step.body))) throw Error('原退件操作记录不完整，请保留记录并联系管理员核对')
      if (!value.steps.every((step: ReturnStep) => options.allowed(step.action))) { blocked.value = true; feedback.value = '原退件操作已保留，当前岗位无权继续，请恢复原权限后核对'; return }
      if (value.contentChanged !== true) delete value.contentChanged
      pending.value = value
      feedback.value = value.contentChanged
        ? '同一次退件操作的内容已变化。请刷新核对原内容，不要继续原请求。若最新单据没有变化，请结束本次后再重新填写。'
        : '发现原退件操作，请核对单号后继续原请求；后端会核对回执，不会重复执行业务'
    } catch (error) { blocked.value = true; feedback.value = userFacingError(error, undefined, '原退件操作无法读取，本次未提交，请恢复存储后重试') }
  }
  async function close() {
    if (pending.value?.contentChanged) return endChanged()
    if (!options.close || busy.value || blocked.value || !pending.value || !options.scope()) return false
    const actor = options.actor(), scope = options.scope(), version = revision
    const active = () => !stopped && revision === version && actor === options.actor() && scope === options.scope()
    busy.value = true
    try {
      return Boolean(await lock(`erp.returns.original.${actor}`, async () => {
        if (!active()) return false
        const raw = options.storage.getItem(key(actor)); if (!raw) return false
        const intent: ReturnIntent = JSON.parse(raw)
        for (const step of intent.steps.slice(intent.index)) {
          if (!active() || !options.allowed(step.action) || options.storage.getItem(key(actor)) !== raw) return false
          const reply = await options.close!(intent.id, structuredClone(step))
          if (!['confirmed', 'cancelled'].includes(reply.outcome)) throw Error('原请求结果尚未确认，记录已保留')
        }
        if (!active() || options.storage.getItem(key(actor)) !== raw) return false
        options.storage.removeItem(key(actor)); if (options.storage.getItem(key(actor)) !== null) throw Error('原操作核对记录未能清理')
        pending.value = null; feedback.value = '已核对结束：已执行结果保留，未执行步骤已封存，请查看当前单据'; return true
      }))
    } catch (error) {
      if (!active()) return false
      if (classifyReturnFailure(actor, error)) return false
      feedback.value = `原操作核对尚未结束，记录已保留。${userFacingError(error)}`
      return false
    }
    finally { if (active()) busy.value = false }
  }
  async function execute(start?: Omit<ReturnIntent, 'index' | 'steps'> & { steps: Omit<ReturnStep, 'clientRequestId'>[] }) {
    if (stopped || busy.value || blocked.value || !options.actor() || !options.scope()) return undefined
    const actor = options.actor(), scope = options.scope(), version = revision
    const active = () => !stopped && revision === version && actor === options.actor() && scope === options.scope()
    busy.value = true
    try {
      return await lock(`erp.returns.original.${actor}`, async () => {
        if (!active()) return undefined
        let raw = options.storage.getItem(key(actor))
        if (start) {
          if (options.storage.getItem(`erp.return.measure-fees.${actor}`)) { feedback.value = '请先核对待处理的测量与算费原请求'; return undefined }
          if (raw) { feedback.value = '已有退件原请求待核对，请先使用“继续原请求”，不要修改后重复提交'; return undefined }
          if (!start.steps.length || !start.steps.every(step => options.allowed(step.action))) throw Error('当前岗位无权执行本次退件操作')
          const value: ReturnIntent = { ...structuredClone(start), index: 0, steps: start.steps.map(step => ({ ...structuredClone(step), clientRequestId: crypto.randomUUID() })) }
          raw = JSON.stringify(value); options.storage.setItem(key(actor), raw)
          if (options.storage.getItem(key(actor)) !== raw) throw Error('原退件操作保存未确认，本次尚未提交')
        }
        if (!raw) return undefined
        let intent: ReturnIntent = JSON.parse(raw); pending.value = intent
        if (intent.contentChanged) {
          feedback.value = '同一次退件操作的内容已变化。请刷新核对原内容，不要继续原请求。若最新单据没有变化，请结束本次后再重新填写。'
          return undefined
        }
        let result: any
        while (intent.index < intent.steps.length) {
          if (!active() || !options.allowed(intent.steps[intent.index].action)) return undefined
          if (options.storage.getItem(key(actor)) !== raw) throw Error('另一页面已更改原退件操作，请重新核对')
          result = await options.request(intent.id, structuredClone(intent.steps[intent.index]))
          if (!active()) return undefined
          if (options.storage.getItem(key(actor)) !== raw) throw Error('原退件操作已被另一页面处理，请重新核对')
          if (intent.index + 1 === intent.steps.length) {
            options.storage.removeItem(key(actor))
            if (options.storage.getItem(key(actor)) !== null) throw Error('原退件回执未能清理，请核对后继续')
            pending.value = null; feedback.value = '原退件操作已确认完成，可刷新列表核对当前状态'; return result
          }
          const next = { ...intent, index: intent.index + 1 }, nextRaw = JSON.stringify(next)
          options.storage.setItem(key(actor), nextRaw)
          if (options.storage.getItem(key(actor)) !== nextRaw) throw Error('退件后续步骤未能保存，请继续核对原请求')
          intent = next; raw = nextRaw; pending.value = next
        }
      })
    } catch (error) {
      if (!active()) return undefined
      if (classifyReturnFailure(actor, error)) return undefined
      feedback.value = `${pending.value ? '原退件操作已保留。' : '退件原请求保存或读取未确认。'}${userFacingError(error)} 请核对后继续原请求。`
      return undefined
    }
    finally { if (active()) busy.value = false }
  }
  watch(() => [options.actor(), options.scope()], () => { revision++; restore() }, { flush: 'sync' })
  const storageChanged = (event: StorageEvent) => { if (event.key === key(options.actor())) { revision++; restore() } }
  if (typeof window !== 'undefined') window.addEventListener('storage', storageChanged)
  onScopeDispose(() => { stopped = true; revision++; if (typeof window !== 'undefined') window.removeEventListener('storage', storageChanged) })
  restore()
  function classifyReturnFailure(actor: string, error: unknown) {
    const source = error as { status?: unknown; response?: { status?: unknown }; message?: unknown }
    const status = Number(source?.status ?? source?.response?.status)
    const text = `${typeof source?.message === 'string' ? source.message : ''} ${userFacingError(error)}`
    const outcome = returnAttemptOutcome(status, text)
    if (pending.value && outcome.contentChanged) {
      const next = { ...pending.value, contentChanged: true as const }
      options.storage.setItem(key(actor), JSON.stringify(next))
      pending.value = next
      feedback.value = returnAttemptMessage('退件操作', outcome)
      return true
    }
    if (pending.value && outcome.statusChanged) {
      options.storage.removeItem(key(actor))
      pending.value = null
      feedback.value = `${userFacingError(error)}。请刷新退件记录后再重新填写，不要继续原请求。`
      return true
    }
    return false
  }
  function endChanged() {
    if (busy.value || !pending.value?.contentChanged) return false
    options.storage.removeItem(key(options.actor()))
    pending.value = null
    feedback.value = '已结束这次未能按本机内容入账的退件操作。请刷新退件记录核对已入账内容；若没有入账，可以重新填写。'
    return true
  }
  return { pending, busy, blocked, feedback, start: (intent: Omit<ReturnIntent, 'index' | 'steps'> & { steps: Omit<ReturnStep, 'clientRequestId'>[] }) => execute(intent), resume: () => execute(), close, restore, endChanged }
}
