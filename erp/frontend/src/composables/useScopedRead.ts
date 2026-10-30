import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'

/** A response belongs to the session and permission scope that started the read. */
export function useScopedRead<T>(scope: () => string | null, read: () => Promise<T>, label: string) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false), error = ref(''), lastRead = ref('')
  let version = 0, stopped = false
  let flight: { key: string; promise: Promise<void> } | null = null

  function refresh(): Promise<void> {
    const key = scope()
    if (!key || stopped) return Promise.resolve()
    if (flight?.key === key) return flight.promise
    const current = { key, promise: null as unknown as Promise<void> }, requestVersion = ++version
    flight = current; loading.value = true; error.value = ''
    const isCurrent = () => !stopped && requestVersion === version && key === scope()
    current.promise = (async () => {
      try {
        const result = await read()
        if (!isCurrent()) return
        data.value = result
        lastRead.value = new Date().toLocaleString('zh-CN', { hour12: false })
      } catch (failure) {
        if (isCurrent()) error.value = `${label}读取未完成。${userFacingError(failure)} ${lastRead.value ? '当前保留上次读取的数据。' : '尚未读取数据。'}请重试。`
      } finally {
        if (flight === current) { flight = null; loading.value = false }
      }
    })()
    return current.promise
  }

  const stopWatch = watch(scope, () => {
    ++version; flight = null
    data.value = null; lastRead.value = ''; error.value = ''; loading.value = false
    void refresh()
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { stopped = true; ++version; flight = null; stopWatch() })
  return { data, loading, error, lastRead, refresh }
}
