import { ref } from 'vue'
import type { Router } from 'vue-router'
import { internalRedirect } from './internalRedirect'
import { isRouteAllowed, type RouteAccess } from '../router/routeAccess'
import { userFacingError } from '@erp/shared/user-facing-error'

type RecoveryApp = RouteAccess & { refreshProfile: () => Promise<boolean | void> }

/** Keeps the original page and session while re-reading an unverified identity. */
export function createAccessRetry(router: Router, app: RecoveryApp, getToken: () => string) {
  const checking = ref(false), feedback = ref('')
  let sequence = 0
  const stop = () => { ++sequence }
  async function retry() {
    if (checking.value) return
    const token = getToken(), current = ++sequence, original = router.currentRoute.value
    const target = internalRedirect(original.query.redirect)
    const active = () => current === sequence && router.currentRoute.value.fullPath === original.fullPath && token === getToken()
    checking.value = true; feedback.value = ''
    try {
      const applied = await app.refreshProfile()
      if (!active()) return
      if (applied === false) {
        feedback.value = '权限信息已被更新，请重新核对后继续。'
        return
      }
      if (isRouteAllowed(router.resolve(target), app)) await router.replace(target)
      else {
        if (original.query.reason === 'permission-read-failed') await router.replace({ name: 'AccessDenied', query: { redirect: target } })
        feedback.value = '已核对最新权限，当前账号仍无法访问此功能。可返回工作台，或联系管理员核对岗位权限。'
      }
    } catch (error) {
      if (active()) feedback.value = `权限信息未能读取。${userFacingError(error)}`
    } finally { if (current === sequence) checking.value = false }
  }
  return { checking, feedback, retry, stop }
}
