
import { userFacingError } from '@erp/shared/user-facing-error'
import { ref, watch, onMounted, onScopeDispose, type Ref } from 'vue'
import { returnsApi } from '@/api/client.js'

export type ReturnStatusFilter =
  | 'all'
  | 'cancelled'
  | 'pending_arrival'
  | 'received'
  | 'measured'
  | 'fee_calculated'
  | 'awaiting_customer'
  | 'accepted_pending'
  | 'dispose_pending'
  | 'completed'
  | 'issue'

export type ReturnCodeField = 'returnNo' | 'orderNo' | 'trackingNo' | 'referenceNo'

export type ReturnListFilters = {
  filter: Ref<ReturnStatusFilter>
  processFilter: Ref<string>
  customerCode: Ref<string>
  returnWarehouse: Ref<string>
  codeField: Ref<ReturnCodeField>
  codeValue: Ref<string>
  skuFilter: Ref<string>
  sellerTaxNo: Ref<string>
  expectedArrivalRange: Ref<[string, string] | null>
  page: Ref<number>
  pageSize: Ref<number>
}

export function buildReturnQueryParams(filters: ReturnListFilters) {
  const params: Record<string, unknown> = {
    page: filters.page.value,
    pageSize: filters.pageSize.value,
  }
  if (filters.filter.value === 'issue') {
    params.requestedProcess = 'other_issue'
  } else if (filters.filter.value !== 'all') {
    params.status = filters.filter.value
  }
  if (filters.processFilter.value) params.requestedProcess = filters.processFilter.value
  const cc = filters.customerCode.value.trim()
  if (cc) params.customerCode = cc
  if (filters.returnWarehouse.value) params.returnWarehouse = filters.returnWarehouse.value
  const code = filters.codeValue.value.trim()
  if (code) params[filters.codeField.value] = code
  const sku = filters.skuFilter.value.trim()
  if (sku) params.sku = sku
  const tax = filters.sellerTaxNo.value.trim()
  if (tax) params.sellerTaxNo = tax
  if (filters.expectedArrivalRange.value?.[0]) params.expectedArrivalFrom = filters.expectedArrivalRange.value[0]
  if (filters.expectedArrivalRange.value?.[1]) params.expectedArrivalTo = filters.expectedArrivalRange.value[1]
  return params
}

/** 退件列表加载、筛选与分页 */
export function useReturnList(scope: () => string | null) {
  const filter = ref<ReturnStatusFilter>('all')
  const processFilter = ref('')
  const customerCode = ref('')
  const returnWarehouse = ref('')
  const codeField = ref<ReturnCodeField>('returnNo')
  const codeValue = ref('')
  const skuFilter = ref('')
  const sellerTaxNo = ref('')
  const expectedArrivalRange = ref<[string, string] | null>(null)

  const page = ref(1)
  const pageSize = ref(20)
  const listTotal = ref(0)
  const loading = ref(false)
  const loadError = ref('')
  let generation = 0, disposed = false, queued = false
  const rows = ref<any[]>([])
  const selectedIds = ref<number[]>([])

  const filters: ReturnListFilters = {
    filter,
    processFilter,
    customerCode,
    returnWarehouse,
    codeField,
    codeValue,
    skuFilter,
    sellerTaxNo,
    expectedArrivalRange,
    page,
    pageSize,
  }

  function clearRows() {
    rows.value = []
    listTotal.value = 0
    selectedIds.value = []
  }

  function currentScope() {
    try { return scope() } catch { return null }
  }

  async function loadList() {
    queued = false
    if (disposed) return false
    const identity = currentScope(), version = ++generation
    const active = () => !disposed && version === generation && !!identity && identity === currentScope()
    clearRows()
    loadError.value = ''
    if (!identity) {
      loading.value = false
      loadError.value = '当前无法读取退件列表，请核对登录和查看权限后重新查询。'
      return false
    }
    loading.value = true
    try {
      const res = await returnsApi.list(buildReturnQueryParams(filters))
      if (!active()) return false
      rows.value = res.items || []
      listTotal.value = res.total || 0
      return true
    } catch (e) {
      if (active()) loadError.value = `退件列表加载失败。${userFacingError(e)} 请重试，也可修改筛选后重新查询。`
      return false
    } finally {
      if (!disposed && version === generation) {
        loading.value = false
        if (identity !== currentScope()) {
          clearRows()
          loadError.value = '登录或查看权限已变化，请使用当前账号重新查询退件列表。'
        }
      }
    }
  }

  function scheduleLoad() {
    if (disposed) return
    ++generation
    clearRows()
    loadError.value = ''
    loading.value = false
    if (queued) return
    queued = true
    void Promise.resolve().then(() => {
      if (!queued || disposed) return
      return loadList()
    })
  }

  function search() {
    page.value = 1
    scheduleLoad()
  }

  function resetFilters() {
    filter.value = 'all'
    processFilter.value = ''
    customerCode.value = ''
    returnWarehouse.value = ''
    codeField.value = 'returnNo'
    codeValue.value = ''
    skuFilter.value = ''
    sellerTaxNo.value = ''
    expectedArrivalRange.value = null
    page.value = 1
    scheduleLoad()
  }

  function setStatusFilter(v: ReturnStatusFilter) {
    filter.value = v
    if (v === 'issue') processFilter.value = ''
    page.value = 1
  }

  function setProcessFilter(v: string) {
    processFilter.value = v
    if (v) filter.value = 'all'
    page.value = 1
  }

  watch([filter, processFilter, page, pageSize], scheduleLoad, { flush: 'sync' })
  watch(currentScope, scheduleLoad, { flush: 'sync' })

  onMounted(scheduleLoad)
  onScopeDispose(() => { disposed = true; queued = false; ++generation; clearRows(); loading.value = false; loadError.value = '' })

  return {
    filters,
    filter,
    processFilter,
    customerCode,
    returnWarehouse,
    codeField,
    codeValue,
    skuFilter,
    sellerTaxNo,
    expectedArrivalRange,
    page,
    pageSize,
    listTotal,
    loading,
    loadError,
    rows,
    selectedIds,
    loadList,
    search,
    resetFilters,
    setStatusFilter,
    setProcessFilter,
    buildParams: () => buildReturnQueryParams(filters),
  }
}
