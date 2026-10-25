import { computed, ref, watch } from 'vue'
import { isNavigationFailure, NavigationFailureType, type Router } from 'vue-router'
import { safeInternalPath } from '../auth/internalRedirect'

/** Same-document fragment navigation must also reload failed module resources. */
export function reloadRecoveryPage(
  path: string,
  location: Pick<Location, 'href' | 'assign' | 'reload'> = window.location,
  history: Pick<History, 'pushState'> = window.history,
) {
  const current = new URL(location.href), target = new URL(safeInternalPath(path), current.origin)
  if (target.pathname === current.pathname && target.search === current.search) {
    if (target.hash !== current.hash) history.pushState(null, '', target.pathname + target.search + target.hash)
    location.reload()
  } else location.assign(target.href)
}

/** Shared by the visible error boundary and real-router recovery tests. */
export function createPageRecovery(router: Router, openPage: (path: string) => void) {
  const failed = ref(false), target = ref(''), feedback = ref(''), returning = ref(false)
  let revision = 0, disposed = false
  const targetPath = computed(() => safeInternalPath(target.value || router.currentRoute.value.fullPath))
  const targetTitle = computed(() => String(router.resolve(targetPath.value).meta.title || '此页面'))
  function reset() { ++revision; failed.value = false; target.value = ''; feedback.value = '' }
  function capture(path: unknown = router.currentRoute.value.fullPath) {
    if (disposed) return
    ++revision; target.value = safeInternalPath(path); feedback.value = ''; failed.value = true
  }
  const removeRouterError = router.onError((_error, to) => capture(to?.fullPath))
  const stopWatch = watch(() => router.currentRoute.value.fullPath, reset)

  function reload() {
    if (disposed || returning.value) return
    feedback.value = ''
    // A full navigation also clears the browser's failed module import cache.
    try { openPage(targetPath.value) }
    catch { feedback.value = '页面未能重新打开，请检查浏览器或网络后重试，或返回工作台。' }
  }
  async function returnHome() {
    if (disposed || returning.value) return
    const original = revision
    returning.value = true; feedback.value = ''
    try {
      const result = await router.push('/dashboard')
      if (disposed || revision !== original) return
      if (isNavigationFailure(result) && !isNavigationFailure(result, NavigationFailureType.duplicated)) {
        feedback.value = '未能返回工作台，请核对页面中的提示后重试。'
      } else reset()
    } catch {
      if (!disposed && failed.value && targetPath.value === '/dashboard') feedback.value = '工作台暂时也无法打开，请检查网络后重试。'
    } finally { if (!disposed) returning.value = false }
  }
  function dispose() { disposed = true; removeRouterError(); stopWatch() }
  return { failed, targetPath, targetTitle, feedback, returning, capture, reload, returnHome, dispose }
}
