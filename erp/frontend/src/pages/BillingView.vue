<script setup lang="ts">
import { displaySku } from '@erp/shared/sku-display'

import { ref, computed, onMounted, watch } from 'vue'

import { billingApi, customerApi } from '@/api/client.js'

import { fmtTime, num } from '@/api/mappers.ts'

import { userFacingError } from '@erp/shared/user-facing-error'
import { readBillingAttempt, saveBillingAttempt, runBillingAttempt, loadAllBillingCharges, BILLING_CHARGE_LABELS, type BillingAttempt } from '@/utils/billingWorkflow'



import { useRowActions } from '@/composables/useRowActions'
import { useAppStore } from '@/stores/app'

import ListPagination from '@/components/ListPagination.vue'

import { TAKEALOT_DEST_FILTER_HINT } from '@/utils/omsWarehouse.ts'
import { loadTakealotDestConfig, useTakealotDestConfig } from '@/composables/useTakealotDestConfig.ts'

const { billingOptions: takealotDestOptions } = useTakealotDestConfig()



const { showDetail, toast } = useRowActions()
const app = useAppStore()



const filterCustomerId = ref<number | ''>('')

const filterCustomerCode = ref('')

const filterSource = ref('all')

const filterType = ref('all')

const filterDestination = ref('')

const dateFrom = ref('')

const dateTo = ref('')



const generateVisible = ref(false)

const generatePreview = ref({ chargeCount: 0, totalAmount: 0, customerCount: 0 })

const chargeDialogVisible = ref(false)

const chargeDetailVisible = ref(false)

const chargeDetailRow = ref<any>(null)

const customers = ref<{ id: number; code: string; name: string; label: string }[]>([])



const generateForm = ref({

  customerId: null as number | null,

  customerCode: '',

  source: 'all',

  chargeType: 'all',

  dateFrom: '',

  dateTo: '',

})



const chargeForm = ref({

  customerId: null as number | null,

  chargeType: 'relabel',

  amount: '',

  description: '',

  chargeDate: new Date().toISOString().slice(0, 10),

})



const CHARGE_TYPES = Object.entries(BILLING_CHARGE_LABELS).map(([value, label]) => ({ value, label }))

const SOURCE_OPTIONS = [

  { value: 'all', label: '全部来源' },

  { value: 'erp', label: 'ERP作业' },
  { value: 'wms', label: '仓库作业' },
  { value: 'oms', label: 'OMS货盘采购' },

  { value: 'manual', label: '手工录入' },

]



const OTHER_DEST_OPTIONS = [

  { value: 'cpt', label: 'CPT 自提' },

  { value: 'fba', label: 'FBA 转运' },

  { value: 'local', label: '本地配送' },

]



const STATUS_MAP: Record<string, { label: string; tone: string }> = {

  pending: { label: '待入账', tone: 'warn' },

  confirmed: { label: '已入账', tone: 'ok' },

  paid: { label: '已结清', tone: 'ok' },

}



function mapSource(source?: string) {

  if (source === 'manual') return '手工录入'
  if (source === 'oms') return 'OMS货盘采购'

  if (source === 'erp') return 'ERP作业'
  if (source === 'wms') return '仓库作业'

  return source ? '其他来源' : '—'

}



function mapCharge(row: any) {

  const st = row.status === 'confirmed'

    ? { label: '已入账', tone: 'ok' }

    : { label: '待入账', tone: 'warn' }

  return {

    rowKey: row.id,

    id: row.chargeNo,

    customer: row.customerName,

    customerCode: row.customerCode || '—',

    type: BILLING_CHARGE_LABELS[row.chargeType] || row.chargeTypeLabel || '其他费用',

    source: mapSource(row.source),

    amount: num(row.amount).toLocaleString(),

    quantity: Number(row.quantity ?? 1),

    destination: row.destination || row.warehouseCode || '—',

    skuItems: Array.isArray(row.skuItems) ? row.skuItems : [],

    chargeTypeCode: row.chargeType || '',

    desc: row.description || '—',

    date: String(row.chargeDate).slice(0, 10),

    status: st.label,

    tone: st.tone,

    ref: row.bizRef || row.sourceRef || '—',

    bizRef: row.bizRef || '—',

    sourceRef: row.sourceRef || '—',

    _raw: row,

  }

}



function mapBill(row: any) {

  const st = STATUS_MAP[row.status] || { label: '待核对', tone: 'info' }

  const typeLabels = (row.items || []).map((i: any) => BILLING_CHARGE_LABELS[i.itemType] || '其他费用').slice(0, 2).join('、') || '汇总'

  return {

    id: row.billingNo,

    customer: row.customerName || `客户 #${row.customerId}`,

    type: typeLabels,

    amount: num(row.totalAmount).toLocaleString(),

    period: row.billingMonth,

    itemCount: row.items?.length ?? 0,

    status: st.label,

    tone: st.tone,

    time: fmtTime(row.createdAt).split(' ')[0],

    _raw: row,

  }

}



const page = ref(1), pageSize = ref(20), total = ref(0), billPage = ref(1), billPageSize = ref(20), billTotal = ref(0)
const chargeError = ref(''), billError = ref(''), customerError = ref('')
let chargeReadVersion = 0, billReadVersion = 0, generateReadVersion = 0, settlementReadVersion = 0

const chargeParams = computed(() => ({

  page: page.value,

  pageSize: pageSize.value,

  customerId: filterCustomerId.value || undefined,

  customerCode: filterCustomerCode.value.trim() || undefined,

  source: filterSource.value === 'all' ? undefined : filterSource.value,

  chargeType: filterType.value === 'all' ? undefined : filterType.value,

  destination: filterDestination.value.trim() || undefined,

  dateFrom: dateFrom.value || undefined,

  dateTo: dateTo.value || undefined,

}))



const chargeLoading = ref(false), billLoading = ref(false), rawCharges = ref<any[]>([]), rawBills = ref<any[]>([])
const pagedItems = rawCharges
function resetPage() { page.value = 1 }
async function loadCharges() {
  const request = ++chargeReadVersion;chargeLoading.value = true;chargeError.value = ''
  try { const res = await billingApi.listCharges(chargeParams.value);if (request !== chargeReadVersion) return;rawCharges.value = (res.items || []).map(mapCharge);total.value = res.total || 0 }
  catch (error) { if (request === chargeReadVersion) chargeError.value = userFacingError(error) }
  finally { if (request === chargeReadVersion) chargeLoading.value = false }
}
async function loadBills() {
  const request = ++billReadVersion;billLoading.value = true;billError.value = ''
  try { const res = await billingApi.list({ page: billPage.value, pageSize: billPageSize.value, customerId: filterCustomerId.value || undefined, customerCode: filterCustomerCode.value.trim() || undefined });if (request !== billReadVersion) return;rawBills.value = (res.items || []).map(mapBill);billTotal.value = res.total || 0 }
  catch (error) { if (request === billReadVersion) billError.value = userFacingError(error) }
  finally { if (request === billReadVersion) billLoading.value = false }
}
watch([page, pageSize], () => { void loadCharges() })
watch([billPage, billPageSize], () => { void loadBills() })
watch([filterCustomerId, filterCustomerCode], () => { billPage.value = 1;void loadBills() })

const tableRef = ref()

const selectedRows = ref<any[]>([])





watch([filterCustomerId, filterCustomerCode, filterSource, filterType, filterDestination, dateFrom, dateTo], () => {

  resetPage()

  selectedRows.value = []

  tableRef.value?.clearSelection?.()

  loadCharges()

})



function onCustomerSelect(id: number | '') {

  filterCustomerId.value = id

  if (id) {

    const hit = customers.value.find(c => c.id === id)

    filterCustomerCode.value = hit?.code || ''

  }

}



function onCustomerCodeInput(code: string) {

  filterCustomerCode.value = code.trim().toUpperCase()

  const hit = customers.value.find(c => c.code.toUpperCase() === filterCustomerCode.value)

  filterCustomerId.value = hit?.id ?? ''

}



function onSelectionChange(rows: any[]) {

  selectedRows.value = rows

}



function clearSelection() {
  tableRef.value?.clearSelection?.()
  selectedRows.value = []
}



async function loadCustomers() {

  customerError.value = ''
  try {

    const rows: any[] = []
    let total = 0
    for (let customerPage = 1; customerPage === 1 || rows.length < total; customerPage++) {
      const result = await customerApi.list({ page: customerPage, pageSize: 200 })
      if (!Array.isArray(result.items) || !Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0 || (customerPage > 1 && total !== Number(result.total))) throw new Error('客户范围已变化，请重新读取后选择')
      total = Number(result.total)
      if (!result.items.length && rows.length < total) throw new Error('客户资料未读取完整，请重新读取')
      rows.push(...result.items)
    }
    if (rows.length !== total || new Set(rows.map(row => Number(row.id))).size !== rows.length) throw new Error('客户资料发生变化，请重新读取')
    const res = { items: rows }

    customers.value = (res.items || []).map((c: any) => ({

      id: Number(c.id),

      code: c.customerCode || '',

      name: c.customerName || c.customerCode,

      label: `${c.customerCode || '—'} · ${c.customerName || ''}`,

    }))

  } catch (error) {

    customerError.value = `客户资料未能读取，请重新读取后继续。${userFacingError(error)}`

  }

}



function onGenerateCustomerSelect(id: number | null) {
  generateForm.value.customerCode = id ? customers.value.find(c => c.id === id)?.code || '' : ''
}
function onGenerateCustomerCodeInput(code: string) {
  generateForm.value.customerCode = code.trim().toUpperCase()
  generateForm.value.customerId = customers.value.find(c => c.code.toUpperCase() === generateForm.value.customerCode)?.id || null
}

function buildGeneratePayload(form = generateForm.value) {

  return {

    dateFrom: form.dateFrom || undefined,

    dateTo: form.dateTo || undefined,

    customerId: form.customerId || undefined,

    customerCode: form.customerCode.trim() || undefined,

    source: form.source === 'all' ? undefined : form.source,

    chargeType: form.chargeType === 'all' ? undefined : form.chargeType,

  }

}



const generateLoading = ref(false), generateError = ref('')
const confirmVisible = ref(false), confirmLoading = ref(false), confirmError = ref(''), confirmBillId = ref<number | null>(null), settlement = ref<any>(null)
const financialBusy = ref(false), billingPending = ref<BillingAttempt | null>(null), billingStorageError = ref(''), billingNotice = ref(''), exportBusy = ref(false)
const financialLocked = computed(() => financialBusy.value || !!billingPending.value || !!billingStorageError.value)
function readPending() {
  try { billingPending.value = readBillingAttempt(localStorage, Number(app.authenticatedUser?.id));billingStorageError.value = '' }
  catch (error) { billingStorageError.value = userFacingError(error) }
}
async function postBilling(attempt: BillingAttempt) {
  if (financialBusy.value) return false
  const operatorId = Number(app.authenticatedUser?.id);financialBusy.value = true;billingNotice.value = ''
  try {
    const response = await runBillingAttempt(billingApi, localStorage, operatorId, attempt)
    billingNotice.value = response.message;readPending()
    if (!response.completed) return false
    toast(response.message);generateVisible.value = false;chargeDialogVisible.value = false;confirmVisible.value = false
    if (attempt.kind === 'manual-charge' || attempt.kind === 'generate') {
      const customerId = attempt.kind === 'manual-charge' ? Number(response.result.customerId) : response.result.bills?.length === 1 ? Number(response.result.bills[0].customerId) : ''
      filterCustomerId.value = customerId
      filterCustomerCode.value = customerId ? customers.value.find(row => row.id === customerId)?.code || '' : ''
      billPage.value = 1;page.value = 1
      if (attempt.kind === 'manual-charge') { filterSource.value = 'manual';filterType.value = attempt.payload.chargeType;dateFrom.value = attempt.payload.chargeDate;dateTo.value = attempt.payload.chargeDate }
    }
    await Promise.allSettled([loadCharges(), loadBills()])
    return true
  } catch (error) { billingNotice.value = userFacingError(error);readPending();return false }
  finally { financialBusy.value = false }
}
async function submitBilling(kind: BillingAttempt['kind'], payload: any, snapshot: any, title: string, billId?: number) {
  readPending();if (financialLocked.value) return false
  const attempt: BillingAttempt = JSON.parse(JSON.stringify({ kind, billId, title, snapshot, payload: { ...payload, clientRequestId: crypto.randomUUID() } }))
  try { saveBillingAttempt(localStorage, Number(app.authenticatedUser?.id), attempt);readPending() }
  catch (error) { billingStorageError.value = userFacingError(error);return false }
  return postBilling(attempt)
}
function restoreBilling() {
  const attempt = billingPending.value;if (!attempt || financialBusy.value) return
  if (attempt.kind === 'generate') { generateForm.value = JSON.parse(JSON.stringify(attempt.snapshot.form));generatePreview.value = attempt.snapshot.preview;generateVisible.value = true }
  else if (attempt.kind === 'manual-charge') { chargeForm.value = JSON.parse(JSON.stringify(attempt.snapshot.form));chargeDialogVisible.value = true }
  else { confirmBillId.value = attempt.billId!;settlement.value = attempt.snapshot;confirmVisible.value = true }
}
async function refreshGeneratePreview() {
  if (billingPending.value) return
  billingNotice.value = ''
  const request = ++generateReadVersion;generateLoading.value = true;generateError.value = ''
  try { const preview = await billingApi.previewGenerate(buildGeneratePayload());if (request === generateReadVersion) generatePreview.value = preview }
  catch (error) { if (request === generateReadVersion) generateError.value = `费用预览未能读取，请重试后继续。${userFacingError(error)}` }
  finally { if (request === generateReadVersion) generateLoading.value = false }
}
async function loadSettlement() {
  if (!confirmBillId.value || billingPending.value) return
  billingNotice.value = ''
  const request = ++settlementReadVersion;confirmLoading.value = true;confirmError.value = '';settlement.value = null
  try { const result = await billingApi.settlementPreview(confirmBillId.value);if (request === settlementReadVersion) settlement.value = result }
  catch (error) { if (request === settlementReadVersion) confirmError.value = `账单和支付依据未能读取，请重试后继续。${userFacingError(error)}` }
  finally { if (request === settlementReadVersion) confirmLoading.value = false }
}
async function submitConfirmBill() {
  if (!settlement.value?.canConfirm || financialLocked.value || confirmLoading.value || confirmError.value) return
  await submitBilling('confirm', { expectedVersion: settlement.value.expectedVersion }, settlement.value, `确认账单 ${settlement.value.billingNo}`, confirmBillId.value!)
}

async function openGenerate() {
  if (!app.hasPerm('billing.generate') || financialLocked.value) return
  billingNotice.value = ''

  generateForm.value = {

    customerId: filterCustomerId.value ? Number(filterCustomerId.value) : null,

    customerCode: filterCustomerCode.value,

    source: filterSource.value,

    chargeType: filterType.value,

    dateFrom: dateFrom.value,

    dateTo: dateTo.value,

  }

  await refreshGeneratePreview()

  generateVisible.value = true

}



watch(generateForm, () => { if (generateVisible.value) void refreshGeneratePreview() }, { deep: true })



async function submitGenerate() {
  if (financialLocked.value || generateLoading.value || generateError.value || !generatePreview.value.chargeCount) return
  await submitBilling('generate', { ...buildGeneratePayload(), expectedVersion: (generatePreview.value as any).expectedVersion }, { form: generateForm.value, preview: generatePreview.value }, '生成账单')
}

function openManualCharge() {
  if (!app.hasPerm('billing.manual') || financialLocked.value) return
  billingNotice.value = ''

  chargeForm.value = {

    customerId: filterCustomerId.value ? Number(filterCustomerId.value) : null,

    chargeType: 'relabel',

    amount: '',

    description: '',

    chargeDate: new Date().toISOString().slice(0, 10),

  }

  chargeDialogVisible.value = true

}



async function submitManualCharge() {
  if (financialLocked.value) return
  if (!chargeForm.value.customerId) return toast('请选择实际收费客户', 'warning')
  if (!/^\d+(\.\d{1,2})?$/.test(chargeForm.value.amount) || Number(chargeForm.value.amount) <= 0) return toast('请填写大于0、最多两位小数的费用金额', 'warning')
  if (!chargeForm.value.chargeDate) return toast('请填写费用日期', 'warning')
  await submitBilling('manual-charge', { customerId: chargeForm.value.customerId, chargeType: chargeForm.value.chargeType, amount: Number(chargeForm.value.amount), description: chargeForm.value.description, chargeDate: chargeForm.value.chargeDate }, { form: chargeForm.value }, '录入手工费用')
}

function resetFilters() {

  filterCustomerId.value = ''

  filterCustomerCode.value = ''

  filterSource.value = 'all'

  filterType.value = 'all'

  filterDestination.value = ''

  dateFrom.value = ''

  dateTo.value = ''

}



function chargeDetail(row: any) {

  chargeDetailRow.value = row

  chargeDetailVisible.value = true

}



function billDetail(row: any) {

  const items = row._raw?.items || []

  const lines = items.map((i: any, idx: number) => [`明细 ${idx + 1}`, `${i.description || BILLING_CHARGE_LABELS[i.itemType] || '其他费用'} · ¥${num(i.amount).toLocaleString()}`])

  showDetail(`账单 · ${row.id}`, [

    ['账单号', row.id], ['客户', row.customer], ['账期', row.period],

    ['费用笔数', row.itemCount], ['合计 (RMB)', `¥ ${row.amount}`], ['状态', row.status], ['日期', row.time],

    ...lines,

  ])

}



async function confirmBill(row: any) {
  if (!app.hasPerm('billing.generate') || financialLocked.value || !['pending', 'confirmed'].includes(row._raw?.status)) return
  billingNotice.value = '';confirmBillId.value = Number(row._raw.id);confirmVisible.value = true
  await loadSettlement()
}

function exportCharges(rows = selectedRows.value) {
  if (!app.hasPerm('billing.export')) return

  const list = rows.length ? rows : rawCharges.value

  if (!list.length) {

    toast('请先勾选要导出的费用，或确保列表有数据', 'warning')

    return

  }

  const headers = ['费用编号', '客户代码', '客户', '费用类型', '来源', '说明', '送达地点', '金额', '费用日期', '状态', '业务单号', 'SKU明细']

  const lines = list.map(r => [

    r.id, r.customerCode, r.customer, r.type, r.source, r.desc,

    r.destination, r.amount.replace(/,/g, ''), r.date, r.status, r.bizRef,

    (r.skuItems || []).map((item: any) => `${item.sku}×${item.quantity}`).join('；'),

  ].map(v => { const value = String(v ?? '');return `"${(/^[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"` }).join(','))

  const csv = '\ufeff' + [headers.join(','), ...lines].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })

  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')

  a.href = url

  a.download = `客户结算费用_${new Date().toISOString().slice(0, 10)}.csv`

  a.click()

  URL.revokeObjectURL(url)

  toast(`已导出 ${list.length} 笔费用`)

}



async function exportAllCharges() {
  if (!app.hasPerm('billing.export') || exportBusy.value) return
  exportBusy.value = true
  try { const { page: _page, pageSize: _pageSize, ...filters } = chargeParams.value;const rows = await loadAllBillingCharges(billingApi, filters);exportCharges(rows.map(mapCharge)) }
  catch (error) { toast(userFacingError(error), 'error') }
  finally { exportBusy.value = false }
}

onMounted(async () => {
  readPending()

  await loadTakealotDestConfig()

  await loadCustomers()

  await loadCharges()

  await loadBills()

})

</script>



<template>

  <div class="billing-page">
    <el-alert v-if="billingStorageError" :title="billingStorageError" type="error" :closable="false" />
    <el-alert v-if="billingPending" :title="`${billingPending.title} 有原账务请求待核对`" type="warning" :closable="false">
      <p>原金额和费用范围已保留，请先核对原操作，勿重新生成或扣款。</p>
      <el-button :disabled="financialBusy" @click="restoreBilling">恢复原操作</el-button>
      <el-button :loading="financialBusy" @click="postBilling(billingPending)">核对并重试原操作</el-button>
    </el-alert>
    <el-alert v-if="billingNotice" :title="billingNotice" type="info" :closable="false" />
    <el-alert v-if="customerError" :title="customerError" type="error" :closable="false"><el-button @click="loadCustomers">重新读取客户</el-button></el-alert>

    <el-card v-loading="chargeLoading">

      <template #header>

        <div class="page-header">

          <span class="page-title">客户结算</span>

          <div class="header-actions">

            <el-button v-if="app.hasPerm('billing.manual')" :disabled="financialLocked || !!customerError" size="small" @click="openManualCharge">+ 手工作业费</el-button>

            <el-button v-if="app.hasPerm('billing.generate')" :disabled="financialLocked || !!customerError" type="primary" size="small" @click="openGenerate">生成账单</el-button>

            <el-button v-if="app.hasPerm('billing.export')" size="small" :disabled="!selectedRows.length" @click="exportCharges()">导出选中</el-button>

            <el-button v-if="app.hasPerm('billing.export')" :loading="exportBusy" size="small" @click="exportAllCharges">导出全部</el-button>

          </div>

        </div>

      </template>



      <div class="callout info">

        <div class="callout-title">费用明细</div>

        <div class="callout-body">

          费用可追溯至系统作业或手工录入。生成账单后先核对已付与未付金额，确认时只扣尚未支付的费用；已扣金额不再重复扣款。

        </div>

      </div>



      <div class="filter-bar">

        <el-select

          :model-value="filterCustomerId"

          placeholder="选择客户"

          clearable

          filterable

          size="small"

          style="width: 200px"

          @update:model-value="onCustomerSelect"

        >

          <el-option v-for="c in customers" :key="c.id" :label="c.label" :value="c.id" />

        </el-select>

        <el-input

          :model-value="filterCustomerCode"

          placeholder="完整客户代码"

          clearable

          size="small"

          style="width: 130px"

          @update:model-value="onCustomerCodeInput"

        />

        <el-select v-model="filterSource" size="small" style="width: 120px">

          <el-option v-for="s in SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />

        </el-select>

        <el-select v-model="filterType" size="small" style="width: 130px">

          <el-option label="全部类型" value="all" />

          <el-option v-for="t in CHARGE_TYPES" :key="t.value" :label="t.label" :value="t.value" />

        </el-select>

        <el-select

          v-model="filterDestination"

          size="small"

          clearable

          filterable

          allow-create

          default-first-option

          placeholder="送达地点 / Takealot 仓"

          style="width: 220px"

          :title="TAKEALOT_DEST_FILTER_HINT"

        >

          <el-option-group label="Takealot 目的仓（静态配置）">
            <el-option v-for="d in takealotDestOptions" :key="d.value" :label="d.label" :value="d.value" />
          </el-option-group>
          <el-option-group label="其他">
            <el-option v-for="d in OTHER_DEST_OPTIONS" :key="d.value" :label="d.label" :value="d.value" />
          </el-option-group>

        </el-select>

        <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" size="small" clearable style="width: 130px" />

        <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" size="small" clearable style="width: 130px" />

        <el-button size="small" @click="resetFilters">重置</el-button>

        <span v-if="selectedRows.length" class="sel-count">已选 {{ selectedRows.length }} 笔</span>

        <el-button v-if="selectedRows.length" size="small" link type="primary" @click="clearSelection">取消选择</el-button>

      </div>



      <el-alert v-if="chargeError" :title="chargeError" type="error" :closable="false"><el-button @click="loadCharges">重新读取费用</el-button></el-alert>
      <el-table

        ref="tableRef"

        :data="pagedItems"

        :row-key="(row: { rowKey: string }) => row.rowKey"

        stripe

        border

        size="small"

        @selection-change="onSelectionChange"

      >

        <el-table-column type="selection" width="42" fixed="left" reserve-selection />

        <el-table-column prop="id" label="费用编号" min-width="170">

          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>

        </el-table-column>

        <el-table-column prop="customerCode" label="客户代码" width="100">

          <template #default="{ row }"><span class="mono">{{ row.customerCode }}</span></template>

        </el-table-column>

        <el-table-column prop="customer" label="客户" min-width="120" show-overflow-tooltip />

        <el-table-column prop="type" label="费用类型" width="100" />

        <el-table-column prop="source" label="来源" width="90" />

        <el-table-column prop="desc" label="说明" min-width="160" show-overflow-tooltip />

        <el-table-column label="送达地点" min-width="160" show-overflow-tooltip>

          <template #default="{ row }">{{ row.destination || '—' }}</template>

        </el-table-column>

        <el-table-column prop="amount" label="金额" width="100" align="right">

          <template #default="{ row }">¥ {{ row.amount }}</template>

        </el-table-column>

        <el-table-column prop="date" label="扣费日期" width="100" />

        <el-table-column prop="status" label="状态" width="82">

          <template #default="{ row }">

            <el-tag :type="row.tone === 'ok' ? 'success' : 'warning'" size="small">{{ row.status }}</el-tag>

          </template>

        </el-table-column>

        <el-table-column label="操作" width="80" fixed="right">

          <template #default="{ row }">

            <el-button link type="primary" size="small" @click="chargeDetail(row)">详情</el-button>

          </template>

        </el-table-column>

      </el-table>

      <el-empty v-if="!chargeLoading && !pagedItems.length" description="暂无费用记录" :image-size="64" style="margin-top:16px" />

      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />

    </el-card>



    <el-card v-loading="billLoading" class="bill-card">

      <template #header>

        <span class="page-title">已生成账单（按客户筛选）</span>

      </template>

      <el-alert v-if="billError" :title="billError" type="error" :closable="false"><el-button @click="loadBills">重新读取账单</el-button></el-alert>
      <el-table :data="rawBills" stripe border size="small">

        <el-table-column prop="id" label="账单号" width="160">

          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>

        </el-table-column>

        <el-table-column prop="customer" label="客户" min-width="140" />

        <el-table-column prop="itemCount" label="费用笔数" width="88" align="center" />

        <el-table-column prop="amount" label="合计 (RMB)" width="120" align="right">

          <template #default="{ row }">¥ {{ row.amount }}</template>

        </el-table-column>

        <el-table-column prop="period" label="账期" width="96" />

        <el-table-column prop="status" label="状态" width="88">

          <template #default="{ row }">

            <el-tag :type="row.tone === 'ok' ? 'success' : row.tone === 'warn' ? 'warning' : 'info'" size="small">{{ row.status }}</el-tag>

          </template>

        </el-table-column>

        <el-table-column prop="time" label="生成日期" width="96" />

        <el-table-column label="操作" width="120" fixed="right">

          <template #default="{ row }">

            <el-button link type="primary" size="small" @click="billDetail(row)">详情</el-button>

            <el-button v-if="app.hasPerm('billing.generate') && ['pending', 'confirmed'].includes(row._raw?.status)" :disabled="financialLocked" link type="warning" size="small" @click="confirmBill(row)">核对确认</el-button>

          </template>

        </el-table-column>

      </el-table>

      <el-empty v-if="!billLoading && !rawBills.length" description="暂无账单，可通过「生成账单」汇总待入账费用" :image-size="56" />
      <ListPagination v-model:page="billPage" v-model:page-size="billPageSize" :total="billTotal" />

    </el-card>



    <el-dialog
      v-model="chargeDetailVisible"
      :title="chargeDetailRow ? `费用明细 · ${chargeDetailRow.id}` : '费用明细'"
      width="720px"
      class="erp-detail"
    >
      <template v-if="chargeDetailRow">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="客户">{{ chargeDetailRow.customer }}</el-descriptions-item>
          <el-descriptions-item label="客户代码"><span class="mono">{{ chargeDetailRow.customerCode }}</span></el-descriptions-item>
          <el-descriptions-item label="费用类型">{{ chargeDetailRow.type }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ chargeDetailRow.source }}</el-descriptions-item>
          <el-descriptions-item label="送达地点" :span="2">{{ chargeDetailRow.destination || '—' }}</el-descriptions-item>
          <el-descriptions-item label="金额">¥ {{ chargeDetailRow.amount }}</el-descriptions-item>
          <el-descriptions-item label="扣费日期">{{ chargeDetailRow.date }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ chargeDetailRow.status }}</el-descriptions-item>
          <el-descriptions-item label="业务单号"><span class="mono">{{ chargeDetailRow.bizRef }}</span></el-descriptions-item>
          <el-descriptions-item label="说明" :span="2">{{ chargeDetailRow.desc }}</el-descriptions-item>
        </el-descriptions>
        <div class="sku-detail-head">SKU 明细</div>
        <el-table :data="chargeDetailRow.skuItems || []" border size="small" max-height="280">
          <el-table-column prop="sku" label="SKU" min-width="140">
            <template #default="{ row }"><span class="mono">{{ displaySku(row) }}</span></template>
          </el-table-column>
          <el-table-column prop="productName" label="商品" min-width="180">
            <template #default="{ row }">{{ row.productName || '—' }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="数量" width="88" align="right" />
        </el-table>
        <el-empty v-if="!(chargeDetailRow.skuItems || []).length" description="该费用没有关联 SKU 明细" :image-size="56" />
      </template>
      <template #footer>
        <el-button @click="chargeDetailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="generateVisible" title="生成账单" width="520px" :close-on-click-modal="false" :close-on-press-escape="!financialBusy" :show-close="!financialBusy">
      <el-alert v-if="billingNotice || billingStorageError" :title="billingNotice || billingStorageError" type="error" :closable="false" />

      <p class="dialog-lead">按筛选条件汇总<strong>待入账</strong>费用，按客户分别生成账单。尚未发运的预估出库费用在最终计费完成后才可入账。</p>

      <el-alert v-if="generateError" :title="generateError" type="error" :closable="false" />
      <el-alert v-if="billingPending" title="当前显示原提交内容。请用原请求核对，不能修改费用范围后重新生成。" type="warning" :closable="false" />
      <el-form label-width="88px" size="small" :disabled="financialLocked">

        <el-form-item label="客户">

          <div class="inline-pair">

            <el-select v-model="generateForm.customerId" @change="onGenerateCustomerSelect" placeholder="选择客户" clearable filterable style="flex:1">

              <el-option v-for="c in customers" :key="c.id" :label="c.label" :value="c.id" />

            </el-select>

            <el-input v-model="generateForm.customerCode" @input="onGenerateCustomerCodeInput" placeholder="完整客户代码" clearable style="width:120px" />

          </div>

        </el-form-item>

        <el-form-item label="来源">

          <el-select v-model="generateForm.source" style="width:100%">

            <el-option v-for="s in SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />

          </el-select>

        </el-form-item>

        <el-form-item label="费用类型">

          <el-select v-model="generateForm.chargeType" style="width:100%">

            <el-option label="全部类型" value="all" />

            <el-option v-for="t in CHARGE_TYPES" :key="t.value" :label="t.label" :value="t.value" />

          </el-select>

        </el-form-item>

        <el-form-item label="时间范围">

          <div class="inline-pair">

            <el-date-picker v-model="generateForm.dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="flex:1" />

            <span class="range-sep">~</span>

            <el-date-picker v-model="generateForm.dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="flex:1" />

          </div>

        </el-form-item>

        <el-divider />

        <el-form-item label="待入账笔数">{{ generatePreview.chargeCount }} 笔</el-form-item>

        <el-form-item label="涉及客户">{{ generatePreview.customerCount }} 个</el-form-item>

        <el-form-item label="待入账合计">

          <span class="amount-highlight">¥ {{ generatePreview.totalAmount.toLocaleString() }} RMB</span>

        </el-form-item>

      </el-form>

      <template #footer>

        <el-button :disabled="financialBusy" @click="generateVisible = false">{{ billingPending ? '返回并核对原操作' : '取消' }}</el-button>

        <el-button :disabled="financialLocked" :loading="generateLoading" @click="refreshGeneratePreview">重新预览</el-button>
        <el-button v-if="billingPending" :loading="financialBusy" type="primary" @click="postBilling(billingPending)">核对并重试原操作</el-button>
        <el-button v-else type="primary" :loading="financialBusy" :disabled="financialLocked || generateLoading || !!generateError || !generatePreview.chargeCount" @click="submitGenerate">确认生成</el-button>

      </template>

    </el-dialog>



    <el-dialog v-model="chargeDialogVisible" title="手工作业费" width="460px" :close-on-click-modal="false" :close-on-press-escape="!financialBusy" :show-close="!financialBusy">
      <el-alert v-if="billingNotice || billingStorageError" :title="billingNotice || billingStorageError" type="error" :closable="false" />

      <el-alert title="录入费用后可生成账单。确认账单时才扣尚未支付的部分，本次录入不直接扣余额。" type="info" :closable="false" />
      <el-alert v-if="billingPending" title="当前显示原费用请求，请先核对原操作，勿重新录入。" type="warning" :closable="false" />
      <el-form label-width="90px" :disabled="financialLocked">

        <el-form-item label="客户" required>

          <el-select v-model="chargeForm.customerId" placeholder="选择客户" filterable style="width:100%">

            <el-option v-for="c in customers" :key="c.id" :label="c.label" :value="c.id" />

          </el-select>

        </el-form-item>

        <el-form-item label="费用类型">

          <el-select v-model="chargeForm.chargeType" style="width:100%">

            <el-option v-for="t in CHARGE_TYPES.filter(t => ['relabel','repack','handling','inspection','other'].includes(t.value))" :key="t.value" :label="t.label" :value="t.value" />

          </el-select>

        </el-form-item>

        <el-form-item label="费用日期">

          <el-date-picker v-model="chargeForm.chargeDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />

        </el-form-item>

        <el-form-item label="金额 (RMB)" required>

          <el-input v-model="chargeForm.amount" placeholder="费用金额，最多两位小数" />

        </el-form-item>

        <el-form-item label="说明">

          <el-input v-model="chargeForm.description" type="textarea" :rows="2" placeholder="如：换标 × 500 件" />

        </el-form-item>

      </el-form>

      <template #footer>

        <el-button :disabled="financialBusy" @click="chargeDialogVisible = false">{{ billingPending ? '返回并核对原操作' : '取消' }}</el-button>

        <el-button v-if="billingPending" :loading="financialBusy" type="primary" @click="postBilling(billingPending)">核对并重试原操作</el-button>
        <el-button v-else type="primary" :disabled="financialLocked || !!customerError" :loading="financialBusy" @click="submitManualCharge">保存费用</el-button>

      </template>

    </el-dialog>

    <el-dialog v-model="confirmVisible" title="核对账单与余额" width="800px" :close-on-click-modal="false" :close-on-press-escape="!financialBusy" :show-close="!financialBusy">
      <el-alert v-if="billingNotice || billingStorageError" :title="billingNotice || billingStorageError" type="error" :closable="false" />
      <el-alert v-if="confirmError" :title="confirmError" type="error" :closable="false" />
      <el-alert v-if="billingPending" title="以下为原提交时核对结果。重试使用原请求，先核对是否已完成，不会再次按当前余额重复扣款。" type="warning" :closable="false" />
      <div v-loading="confirmLoading" v-if="settlement">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="账单">{{ settlement.billingNo }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ settlement.customerName }}</el-descriptions-item>
          <el-descriptions-item label="账单合计">¥{{ Number(settlement.totalAmount).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="已付，不再扣">¥{{ Number(settlement.alreadyPaidAmount).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="本次仅扣未付">¥{{ Number(settlement.toDeductAmount).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="当前余额">¥{{ Number(settlement.balance).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="确认后余额" :span="2">¥{{ Number(settlement.remainingBalance).toFixed(2) }}</el-descriptions-item>
        </el-descriptions>
        <el-alert v-for="reason in settlement.blockedReasons" :key="reason" :title="reason" type="error" :closable="false" />
        <el-alert v-if="!settlement.balanceSufficient" title="余额不足，本次尚未扣款。请先完成充值，再重新核对余额。" type="warning" :closable="false" />
        <el-table :data="settlement.charges" border size="small" max-height="300" style="margin-top:12px">
          <el-table-column prop="chargeType" label="费用" min-width="100" />
          <el-table-column label="金额" width="90"><template #default="{ row }">¥{{ Number(row.amount).toFixed(2) }}</template></el-table-column>
          <el-table-column label="已付" width="90"><template #default="{ row }">¥{{ Number(row.alreadyPaidAmount).toFixed(2) }}</template></el-table-column>
          <el-table-column label="本次扣" width="90"><template #default="{ row }">¥{{ Number(row.toDeductAmount).toFixed(2) }}</template></el-table-column>
          <el-table-column prop="paidReason" label="支付依据" min-width="150" />
        </el-table>
      </div>
      <template #footer>
        <el-button :disabled="financialBusy" @click="confirmVisible = false">返回账单列表</el-button>
        <el-button :disabled="financialLocked" :loading="confirmLoading" @click="loadSettlement">重新核对余额</el-button>
        <el-button v-if="billingPending" type="primary" :loading="financialBusy" @click="postBilling(billingPending)">核对并重试原操作</el-button>
        <el-button v-else type="primary" :loading="financialBusy" :disabled="financialLocked || confirmLoading || !!confirmError || !settlement?.canConfirm" @click="submitConfirmBill">{{ settlement?.toDeductAmount > 0 ? '确认并扣未付费用' : '确认核对已付费用' }}</el-button>
      </template>
    </el-dialog>

  </div>

</template>



<style scoped>

.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }

.page-title { font-weight: 600; font-size: 15px; }

.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }

.mono { font-family: var(--font-mono); font-size: 12px; }

.sel-count { font-size: 12px; color: #64748b; }

.callout { border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; }

.callout.info { background: #f0f7ff; border: 1px solid #bfdbfe; }

.callout-title { font-weight: 600; margin-bottom: 4px; color: #1e40af; }

.callout-body { color: #475569; line-height: 1.5; }

.bill-card { margin-top: 16px; }

.dialog-lead { margin: 0 0 16px; font-size: 13px; color: #475569; line-height: 1.5; }

.inline-pair { display: flex; align-items: center; gap: 8px; width: 100%; }

.range-sep { color: #94a3b8; flex-shrink: 0; }

.amount-highlight { font-family: var(--font-mono); color: #dc2626; font-weight: 600; }

.sku-detail-head { margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: #334155; }

</style>
