import { ref, watch } from 'vue'
import type { Router } from 'vue-router'
import { userFacingError } from '@erp/shared/user-facing-error'
import { internalRedirect } from './internalRedirect'
import { subscribePermissionFailures } from './permissionEvents'
import { isRouteAllowed, type RouteAccess } from '../router/routeAccess'

export type AccessCheckResult = 'ready' | 'failed' | 'changed' | 'anonymous'
type LiveApp = RouteAccess & {
  profileRevision?: number
  isAuthenticated: boolean
  authenticatedUser: { id: number; roleCode: string; permissions?: string[]; workstation?: string | null } | null
  refreshProfile: () => Promise<boolean | void>
}

export function createLiveAccess(router: Router, getApp: () => LiveApp, getToken: () => string) {
  const checking = ref(false), error = ref(''), notice = ref('')
  let flight: { owner: string; promise: Promise<AccessCheckResult> } | null = null
  let recovery: { owner: string; promise: Promise<AccessCheckResult> } | null = null
  let stopped = false
  const owner = () => `${getToken()}\0${getApp().authenticatedUser?.id || ''}\0${getApp().isAuthenticated}`
  const signature = () => {
    const user = getApp().authenticatedUser
    return JSON.stringify([user?.roleCode, user?.workstation, user?.permissions?.slice().sort()])
  }

  async function refresh(): Promise<AccessCheckResult> {
    const key = owner(), app = getApp()
    if (stopped || !getToken() || !app.isAuthenticated) return 'anonymous'
    if (flight?.owner === key) return flight.promise
    const before = signature(), beforeRevision = app.profileRevision
    const current = { owner: key, promise: null as unknown as Promise<AccessCheckResult> }
    flight = current; checking.value = true
    current.promise = (async () => {
      try {
        const applied = await app.refreshProfile()
        if (stopped) return 'changed'
        if (key !== owner()) return getToken() ? 'changed' : 'anonymous'
        if (applied === false && app.profileRevision === beforeRevision) {
          error.value = '本次权限核对已被更新的请求替代，请重新核对后继续操作。'
          return 'failed'
        }
        error.value = ''
        if (signature() !== before) notice.value = '岗位或权限已更新，菜单和可用操作已同步。'
        return 'ready'
      } catch (failure) {
        if (stopped) return 'changed'
        if (key !== owner()) return getToken() ? 'changed' : 'anonymous'
        error.value = `权限信息未能读取。${userFacingError(failure)} 请重新核对后继续操作。`
        return 'failed'
      } finally {
        if (flight === current) { flight = null; checking.value = false }
      }
    })()
    return current.promise
  }

  async function refreshCurrent(): Promise<AccessCheckResult> {
    const key = owner()
    if (recovery?.owner === key) return recovery.promise
    const action = { owner: key, promise: null as unknown as Promise<AccessCheckResult> }
    recovery = action
    action.promise = (async () => {
      try {
        const result = await refresh()
        if (stopped || key !== owner()) return 'changed'
        if (result === 'ready' && !isRouteAllowed(router.currentRoute.value, getApp())) {
          const target = internalRedirect(router.currentRoute.value.fullPath)
          try { await router.replace({ name: 'AccessDenied', query: { redirect: target } }) }
          catch { if (key === owner()) error.value = '权限已更新，但恢复页面未能打开。请重新加载页面或返回工作台。' }
        }
        return result
      } finally { if (recovery === action) recovery = null }
    })()
    return action.promise
  }

  function start(win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document) {
    stopped = false
    const checkVisible = () => { if (doc.visibilityState === 'visible') void refreshCurrent() }
    const unsubscribe = subscribePermissionFailures(() => { void refreshCurrent() })
    const stopWatch = watch(owner, () => { error.value = ''; notice.value = ''; checking.value = !!flight && flight.owner === owner() })
    const stopProfileWatch = watch(() => getApp().profileRevision, () => { error.value = '' })
    const timer = setInterval(checkVisible, 30_000)
    win.addEventListener('focus', checkVisible); doc.addEventListener('visibilitychange', checkVisible)
    return () => {
      stopped = true; clearInterval(timer); unsubscribe(); stopWatch(); stopProfileWatch()
      win.removeEventListener('focus', checkVisible); doc.removeEventListener('visibilitychange', checkVisible)
    }
  }
  function clearFeedback() { error.value = ''; notice.value = '' }
  return { checking, error, notice, refresh, refreshCurrent, start, clearFeedback }
}
