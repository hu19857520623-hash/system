import { ref, computed, watch, type MaybeRefOrGetter, toValue } from 'vue'

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

/** 对列表数据做前端分页切片 */
export function useTablePagination<T>(
  source: MaybeRefOrGetter<T[]>,
  opts?: { defaultPageSize?: number },
) {
  const page = ref(1)
  const pageSize = ref(opts?.defaultPageSize ?? 20)

  const total = computed(() => toValue(source).length)

  const pagedItems = computed(() => {
    const all = toValue(source)
    const start = (page.value - 1) * pageSize.value
    return all.slice(start, start + pageSize.value)
  })

  watch([total, pageSize], () => {
    const max = Math.max(1, Math.ceil(total.value / pageSize.value) || 1)
    if (page.value > max) page.value = max
  })

  function resetPage() {
    page.value = 1
  }

  return { page, pageSize, total, pagedItems, resetPage, PAGE_SIZE_OPTIONS }
}

/** 服务端分页状态（列表数据由 API 按 page/pageSize 返回） */
export function useServerPagination(opts?: { defaultPageSize?: number }) {
  const page = ref(1)
  const pageSize = ref(opts?.defaultPageSize ?? 20)
  const total = ref(0)

  function resetPage() {
    page.value = 1
  }

  return { page, pageSize, total, resetPage, PAGE_SIZE_OPTIONS }
}
