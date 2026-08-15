import { ref, shallowRef } from 'vue'
import { ElMessage } from 'element-plus'

export function useListLoader<T = any>(
  fetcher: () => Promise<any>,
  opts?: { errorMsg?: string },
) {
  const loading = ref(false)
  const items = shallowRef<T[]>([])
  const total = ref(0)

  async function load() {
    loading.value = true
    try {
      const res = await fetcher()
      if (Array.isArray(res)) {
        items.value = res
        total.value = res.length
      } else {
        items.value = (res.items || []) as T[]
        total.value = res.total ?? items.value.length
      }
    } catch (e: any) {
      ElMessage.error(e?.message || opts?.errorMsg || '加载失败')
    } finally {
      loading.value = false
    }
  }

  return { loading, items, total, load }
}

export async function withAction(fn: () => Promise<void>, okMsg?: string) {
  try {
    await fn()
    if (okMsg) ElMessage.success(okMsg)
    return true
  } catch (e: any) {
    ElMessage.error(e?.message || '操作失败')
    return false
  }
}
