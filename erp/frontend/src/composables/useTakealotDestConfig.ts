import { ref, computed } from 'vue'
import { takealotDestApi } from '@/api/client.js'
import { applyTakealotDestRuntimeRows } from '@/utils/omsWarehouse.ts'

export type TakealotDestItem = {
  id?: number
  code: string
  omsWarehouseId: string | null
  label: string
  city: string | null
  matchAliases: string[]
  enabled: boolean
  sortOrder: number
}

const items = ref<TakealotDestItem[]>([])
const loaded = ref(false)
const loading = ref(false)
let inflight: Promise<TakealotDestItem[]> | null = null

export async function loadTakealotDestConfig(force = false) {
  if (!force && loaded.value) return items.value
  if (inflight) return inflight
  loading.value = true
  inflight = takealotDestApi.list()
    .then((res: { items?: TakealotDestItem[] }) => {
      items.value = res.items || []
      loaded.value = true
      applyTakealotDestRuntimeRows(items.value)
      return items.value
    })
    .catch(() => {
      items.value = []
      loaded.value = false
      return items.value
    })
    .finally(() => {
      loading.value = false
      inflight = null
    })
  return inflight
}

export function useTakealotDestConfig() {
  const billingOptions = computed(() =>
    items.value
      .filter((row) => row.enabled)
      .map((row) => ({
        value: row.code,
        label: row.city ? `${row.code} · ${row.city}` : row.label || row.code,
      })),
  )

  const outboundFilterOptions = computed(() => {
    const seen = new Set<string>()
    const opts: { value: string; label: string }[] = [{ value: 'all', label: '全部' }]
    for (const row of items.value.filter((r) => r.enabled && r.omsWarehouseId)) {
      const id = row.omsWarehouseId!
      if (seen.has(id)) continue
      seen.add(id)
      opts.push({
        value: id,
        label: row.city ? `${id.toUpperCase()} · ${row.city}` : id.toUpperCase(),
      })
    }
    return opts
  })

  return {
    items,
    loaded,
    loading,
    billingOptions,
    outboundFilterOptions,
    reload: () => loadTakealotDestConfig(true),
  }
}

export const TAKEALOT_DEST_FILTER_HINT =
  'Takealot 平台目的仓由「Takealot 目的仓配置」维护，与 WMS 仓库主数据（WMS-JHB-01 等）分开管理。'
