import { ref, watch, onMounted, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
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
export function useReturnList() {
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

  async function loadList() {
    loading.value = true
    try {
      const res = await returnsApi.list(buildReturnQueryParams(filters))
      rows.value = res.items || []
      listTotal.value = res.total || 0
      selectedIds.value = []
    } catch (e: any) {
      ElMessage.error(e?.message || '加载失败')
    } finally {
      loading.value = false
    }
  }

  function search() {
    page.value = 1
    void loadList()
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
    void loadList()
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

  watch([filter, processFilter, page, pageSize], () => {
    void loadList()
  })

  onMounted(() => {
    void loadList()
  })

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
