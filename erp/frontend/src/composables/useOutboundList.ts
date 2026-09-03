import { ref, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { outboundApi } from '@/api/client.js'

export type OutboundStatusFilter =
  | 'all'
  | 'pending_relabel'
  | 'pending_pick'
  | 'picking'
  | 'picked'
  | 'reviewing'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'partial_delivered'
  | 'delivery_failed'
  | 'cancelled'
  | 'exception'
  | 'problem'

export type OutboundListFilters = {
  filterStatus: Ref<OutboundStatusFilter>
  searchQ: Ref<string>
  filterCustomer: Ref<number | ''>
  filterDest: Ref<string>
  filterSku: Ref<string>
  filterLogisticsProduct: Ref<string>
  filterPicker: Ref<number | ''>
  filterNeedsRelabel: Ref<string>
  filterIsProblem: Ref<string>
  filterPlatform: Ref<string>
  filterAppointment: Ref<string>
  dateRange: Ref<[string, string] | null>
  appointmentDateRange: Ref<[string, string] | null>
  page: Ref<number>
  pageSize: Ref<number>
}

const EMPTY_COUNTS: Record<string, number> = {
  all: 0,
  pending_relabel: 0,
  pending_pick: 0,
  picking: 0,
  picked: 0,
  reviewing: 0,
  packed: 0,
  shipped: 0,
  delivered: 0,
  partial_delivered: 0,
  delivery_failed: 0,
  cancelled: 0,
  exception: 0,
  problem: 0,
}

export function buildOutboundQueryParams(filters: OutboundListFilters, skipStatus = false) {
  const p: Record<string, unknown> = { page: filters.page.value, pageSize: filters.pageSize.value }
  if (!skipStatus && filters.filterStatus.value !== 'all') {
    if (filters.filterStatus.value === 'problem') {
      p.isProblem = 'true'
    } else if (filters.filterStatus.value === 'exception') {
      p.status = 'exception'
    } else {
      p.status = filters.filterStatus.value
    }
  }
  const kw = filters.searchQ.value.trim()
  if (kw) p.keyword = kw
  if (filters.filterCustomer.value) p.customerId = String(filters.filterCustomer.value)
  if (filters.filterDest.value !== 'all') p.destWarehouse = filters.filterDest.value
  const sku = filters.filterSku.value.trim()
  if (sku) p.sku = sku
  if (filters.dateRange.value?.[0]) p.createdFrom = filters.dateRange.value[0]
  if (filters.dateRange.value?.[1]) p.createdTo = filters.dateRange.value[1]
  if (filters.filterLogisticsProduct.value !== 'all') p.logisticsProduct = filters.filterLogisticsProduct.value
  if (filters.filterPicker.value) p.pickerId = String(filters.filterPicker.value)
  if (filters.filterNeedsRelabel.value !== 'all') p.needsRelabel = filters.filterNeedsRelabel.value
  if (filters.filterIsProblem.value !== 'all') p.isProblem = filters.filterIsProblem.value
  if (filters.filterPlatform.value !== 'all') p.platform = filters.filterPlatform.value
  if (filters.filterAppointment.value !== 'all') p.appointmentStatus = filters.filterAppointment.value
  if (filters.appointmentDateRange.value?.[0]) p.appointmentFrom = filters.appointmentDateRange.value[0]
  if (filters.appointmentDateRange.value?.[1]) p.appointmentTo = filters.appointmentDateRange.value[1]
  return p
}

/** 出库列表加载、筛选与分页状态 */
export function useOutboundList() {
  const filterStatus = ref<OutboundStatusFilter>('pending_pick')
  const searchQ = ref('')
  const filterCustomer = ref<number | ''>('')
  const filterDest = ref('all')
  const filterSku = ref('')
  const filterLogisticsProduct = ref('all')
  const filterPicker = ref<number | ''>('')
  const filterNeedsRelabel = ref('all')
  const filterIsProblem = ref('all')
  const filterPlatform = ref('all')
  const filterAppointment = ref('all')
  const dateRange = ref<[string, string] | null>(null)
  const appointmentDateRange = ref<[string, string] | null>(null)

  const page = ref(1)
  const pageSize = ref(50)
  const listTotal = ref(0)
  const loading = ref(false)
  const orders = ref<any[]>([])
  const statusCounts = ref<Record<string, number>>({ ...EMPTY_COUNTS })

  const filters: OutboundListFilters = {
    filterStatus,
    searchQ,
    filterCustomer,
    filterDest,
    filterSku,
    filterLogisticsProduct,
    filterPicker,
    filterNeedsRelabel,
    filterIsProblem,
    filterPlatform,
    filterAppointment,
    dateRange,
    appointmentDateRange,
    page,
    pageSize,
  }

  async function refreshCounts() {
    try {
      statusCounts.value = await outboundApi.statusCounts(buildOutboundQueryParams(filters, true))
    } catch {
      // 计数失败不影响列表
    }
  }

  async function load() {
    loading.value = true
    try {
      const res = await outboundApi.list(buildOutboundQueryParams(filters))
      orders.value = res.items || []
      listTotal.value = res.total ?? orders.value.length
    } catch (e: any) {
      ElMessage.error(e?.message || '加载失败')
    } finally {
      loading.value = false
    }
  }

  async function reloadAll() {
    await Promise.all([load(), refreshCounts()])
  }

  function search() {
    page.value = 1
    void reloadAll()
  }

  function rowIndex(index: number) {
    return (page.value - 1) * pageSize.value + index + 1
  }

  watch(filterStatus, () => {
    page.value = 1
    void reloadAll()
  })

  watch([page, pageSize], () => {
    void reloadAll()
  })

  return {
    filters,
    filterStatus,
    searchQ,
    filterCustomer,
    filterDest,
    filterSku,
    filterLogisticsProduct,
    filterPicker,
    filterNeedsRelabel,
    filterIsProblem,
    filterPlatform,
    filterAppointment,
    dateRange,
    appointmentDateRange,
    page,
    pageSize,
    listTotal,
    loading,
    orders,
    statusCounts,
    load,
    refreshCounts,
    reloadAll,
    search,
    rowIndex,
    buildQueryParams: (skipStatus = false) => buildOutboundQueryParams(filters, skipStatus),
  }
}
