import { ref, computed } from 'vue'
import { dashboardApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'

export type NotificationTone = 'warn' | 'err' | 'info'

export interface NotificationItem {
  key: string
  screenId: string
  title: string
  count: number
  route: string
  tone: NotificationTone
}

const items = ref<NotificationItem[]>([])
const badges = ref<Record<string, number>>({})
const loading = ref(false)
const loaded = ref(false)

export function useNotifications() {
  const app = useAppStore()

  const visibleItems = computed(() =>
    items.value.filter((item) => item.count > 0 && app.canViewScreen(item.screenId)),
  )

  const totalCount = computed(() =>
    visibleItems.value.reduce((sum, item) => sum + item.count, 0),
  )

  const badgeCount = computed(() => {
    const n = totalCount.value
    if (!n) return ''
    return n > 99 ? '99+' : String(n)
  })

  function getBadge(key?: string): number {
    if (!key) return 0
    return badges.value[key] ?? 0
  }

  async function loadNotifications() {
    loading.value = true
    try {
      const res = await dashboardApi.notifications()
      items.value = res.items || []
      badges.value = res.badges || {}
      loaded.value = true
    } catch {
      if (!loaded.value) {
        items.value = []
        badges.value = {}
      }
    } finally {
      loading.value = false
    }
  }

  return {
    items,
    badges,
    loading,
    loaded,
    visibleItems,
    totalCount,
    badgeCount,
    getBadge,
    loadNotifications,
  }
}
