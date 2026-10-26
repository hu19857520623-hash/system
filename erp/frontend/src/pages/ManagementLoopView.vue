<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { locationApi, managementLoopApi, warehouseApi } from '@/api/client.js'
import { mapWarehouse } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'
import { userFacingError } from '@erp/shared/user-facing-error'
import { inboundStatus, outboundStatus, planStatus, lineStatus, stocktakeMode, alertLevel, exceptionType, collectReport } from '@/features/management/presentation'
import { createStocktakeAction } from '@/features/management/stocktakeAction'
import { createCapacityRefresh } from '@/features/management/capacityRefresh'
import { downloadCsv } from '@/utils/csv.ts'

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const activeTab = computed(() => String(route.meta.tab || 'reports'))
const loading = ref(false)
const readErrors = reactive<Record<string, string>>({})
const readLoaded = reactive<Record<string, boolean>>({})
const readVersions: Record<string, number> = {}
let viewAlive = true
async function readPage(kind: string, work: () => Promise<any>, apply: (data: any) => void) {
  if (!viewAlive) return false
  const version = readVersions[kind] = (readVersions[kind] || 0) + 1
  const owner = app.authenticatedUser?.id
  if (kind === activeTab.value) loading.value = true
  readErrors[kind] = ''
  try {
    const result = await work()
    if (!viewAlive || readVersions[kind] !== version || owner !== app.authenticatedUser?.id) return false
    apply(result); readLoaded[kind] = true
    return true
  } catch (error) {
    if (readVersions[kind] === version && owner === app.authenticatedUser?.id) readErrors[kind] = `${userFacingError(error)} ${readLoaded[kind] ? '当前保留上次读取的结果，请重新查询。' : '尚未读取到本次数据，请重试。'}`
    return false
  } finally { if (readVersions[kind] === version && kind === activeTab.value) loading.value = false }
}
const warehouses = ref<any[]>([])
const warehouseCode = ref('')

const tabs = [
  { key: 'reports', label: '真实作业报表', path: '/wms/reports', perm: 'wms_reports.view' },
  { key: 'stocktake', label: '多模式盘点', path: '/wms/stocktake', perm: 'stocktake.view' },
  { key: 'capacity', label: '容量与预警', path: '/wms/capacity', perm: 'capacity.view' },
]
const visibleTabs = computed(() => tabs.filter((tab) => app.hasPerm(tab.perm) || app.authenticatedUser?.roleCode === 'admin'))

function switchTab(key: string | number) {
  const tab = tabs.find((item) => item.key === String(key))
  if (tab) void router.push(tab.path).catch(error => ElMessage.error(userFacingError(error)))
}

const dateRange = ref<string[]>([])
const rangePreset = ref('all')
const exporting = ref(false)
const inboundTotal = ref(0)
const outboundTotal = ref(0)
const reportSummary = ref<any>({ inbound: {}, outbound: {} })
const inboundRows = ref<any[]>([])
const outboundRows = ref<any[]>([])

function padDate(n: number) {
  return String(n).padStart(2, '0')
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${padDate(d.getMonth() + 1)}-${padDate(d.getDate())}`
}
function startOfWeek(d: Date) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = copy.getDay() || 7
  copy.setDate(copy.getDate() - (day - 1))
  return copy
}
function applyPreset(preset: string | number | boolean = '') {
  const key = String(preset || '')
  rangePreset.value = key === 'all' ? 'all' : key
  if (!key || key === 'all') {
    dateRange.value = []
    loadReports()
    return
  }
  const now = new Date()
  if (key === 'today') dateRange.value = [ymd(now), ymd(now)]
  else if (key === 'week') dateRange.value = [ymd(startOfWeek(now)), ymd(now)]
  else if (key === 'month') dateRange.value = [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)]
  loadReports()
}
function onDateRangeChange() {
  rangePreset.value = dateRange.value?.length ? 'custom' : 'all'
  void loadReports()
}

function reportParams(pageSize = 100) {
  return {
    warehouseCode: warehouseCode.value || undefined,
    dateFrom: dateRange.value?.[0], dateTo: dateRange.value?.[1],
    page: 1, pageSize,
  }
}

function formatTs(value?: string | Date | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getFullYear()}-${padDate(d.getMonth() + 1)}-${padDate(d.getDate())} ${padDate(d.getHours())}:${padDate(d.getMinutes())}`
}
function formatCbm(value?: number | null) {
  return (Number(value) || 0).toFixed(4)
}
function formatMoney(value?: number | null) {
  return `¥ ${(Number(value) || 0).toFixed(2)}`
}

async function loadReports() {
  const params = reportParams()
  await readPage('reports', () => Promise.all([
    managementLoopApi.reportSummary(params), managementLoopApi.inboundReport(params), managementLoopApi.outboundReport(params),
  ]), ([summary, inbound, outbound]) => {
    reportSummary.value = summary; inboundRows.value = inbound.items || []; outboundRows.value = outbound.items || []
    inboundTotal.value = inbound.total || 0; outboundTotal.value = outbound.total || 0
  })
}
async function exportReports(kind: 'inbound' | 'outbound') {
  if (exporting.value) return
  exporting.value = true
  const params = reportParams(5000)
  try {
    const rows = await collectReport(kind === 'inbound' ? managementLoopApi.inboundReport : managementLoopApi.outboundReport, params, kind === 'inbound' ? 'inboundNo' : 'outboundNo')
    if (!rows.length) { ElMessage.warning('当前范围没有可导出的数据'); return }
    if (kind === 'inbound') downloadCsv(`入库作业报表_${ymd(new Date())}.csv`, [
      '入库单号', '仓库', '客户', '状态', '应收', '实收', '上架', '箱数', 'CBM', '费用', '收货人', '清点人', '到仓时间', '完成时间',
    ], rows.map(row => [row.inboundNo, row.warehouseCode, row.customerCode, inboundStatus(row.status), row.expectedQty, row.receivedQty, row.putawayQty, row.cartonCount, formatCbm(row.cbm), Number(row.feeAmount || 0).toFixed(2), row.receivedByName, row.qcByName, formatTs(row.arrivedAt), formatTs(row.putawayAt)]))
    else downloadCsv(`出库作业报表_${ymd(new Date())}.csv`, [
      '出库单号', '仓库', '状态', '订单件数', '拣货件数', 'CBM', '承运商', '异常', '费用', '拣货人', '复核人', '创建时间', '发运时间',
    ], rows.map(row => [row.outboundNo, row.warehouseCode, outboundStatus(row.status), row.qty, row.pickedQty, formatCbm(row.cbm), row.carrier, exceptionType(row.exceptionType), Number(row.feeAmount || 0).toFixed(2), row.pickerName, row.reviewerName, formatTs(row.createdAt), formatTs(row.shippedAt)]))
    ElMessage.success('已发起文件下载，请在浏览器下载列表查看')
  } catch (error) { ElMessage.error(`${userFacingError(error)} 可保留当前筛选条件后重试导出。`) }
  finally { exporting.value = false }
}

const stocktakes = ref<any[]>([])
const stocktakeDialog = ref(false)
const countDialog = ref(false)
const transitionDialog = ref(false)
const transitionForm = reactive({ action: 'cancel' as 'cancel' | 'replan', id: 0, stocktakeNo: '', expectedVersion: '', reason: '' })
const transitionTitle = computed(() => transitionForm.action === 'replan' ? '复制原明细重新盘点' : '取消盘点')
const planIsActive = computed(() => ['counting', 'pending_approval'].includes(currentPlan.value?.status))
const locations = ref<any[]>([])
const stocktakeCustomers = ref<{ customerCode: string }[]>([])
const currentPlan = ref<any>(null)
const stocktakeForm = reactive<any>({
  warehouseCode: '', mode: 'location', blindCount: true, locationIds: [], skusText: '', sampleSize: 20,
  customerCode: '', inboundNo: '', inboundDateRange: [] as string[], remark: '',
})
function applyPlan(plan: any) {
  const previous = new Map((currentPlan.value?.lines || []).map((line: any) => [line.id, line]))
  currentPlan.value = { ...plan, lines: (plan.lines || []).map((line: any) => {
    const old = previous.get(line.id) as any
    return { ...line, inputQty: old?.status === line.status ? old.inputQty ?? null : null }
  }) }
}
const stocktakeOperation = createStocktakeAction({
  owner: () => String(app.authenticatedUser?.id || ''), storage: sessionStorage,
  send: attempt => {
    const payload = { ...attempt.payload, clientRequestId: attempt.requestId }
    if (attempt.action === 'create') return managementLoopApi.createStocktake(payload)
    if (attempt.action === 'count') return managementLoopApi.countStocktake(attempt.planId, payload)
    if (attempt.action === 'cancel') return managementLoopApi.cancelStocktake(attempt.planId, payload)
    if (attempt.action === 'replan') return managementLoopApi.replanStocktake(attempt.planId, payload)
    return managementLoopApi.approveStocktake(attempt.planId, payload)
  },
  lookup: key => managementLoopApi.stocktakeRequest(key),
  applied: (_action, plan) => {
    applyPlan(plan); transitionDialog.value = false; stocktakeDialog.value = false; countDialog.value = true
    void loadStocktakes()
  },
})
const { pending: pendingStocktake, busy: stocktakeBusy, feedback: stocktakeFeedback } = stocktakeOperation
onBeforeUnmount(() => { viewAlive = false; stocktakeOperation.stop(); ++optionsVersion; ++planVersion; for (const key of Object.keys(readVersions)) ++readVersions[key] })
const stocktakeOptionsError = ref(''), optionsLoading = ref(false)
let optionsVersion = 0, optionsWarehouse = ''

async function loadStocktakes() {
  const code = warehouseCode.value
  await readPage('stocktake', () => managementLoopApi.stocktakes({ warehouseCode: code || undefined }), rows => { stocktakes.value = rows })
}
async function onStocktakeWarehouseChange(code: string) {
  const version = ++optionsVersion
  if (code !== optionsWarehouse) stocktakeForm.locationIds = []
  optionsWarehouse = code
  optionsLoading.value = true; stocktakeOptionsError.value = ''; locations.value = []; stocktakeCustomers.value = []
  try {
    const [locationResult, options] = await Promise.all([
      code ? locationApi.list({ warehouseCode: code }) : [],
      code && app.hasPerm('stocktake.create') ? managementLoopApi.stocktakeOptions({ warehouseCode: code }) : { customers: [] },
    ])
    if (version !== optionsVersion || code !== stocktakeForm.warehouseCode) return
    locations.value = Array.isArray(locationResult) ? locationResult : locationResult.items || []
    stocktakeCustomers.value = options.customers || []
  } catch (error) { if (version === optionsVersion) stocktakeOptionsError.value = userFacingError(error) }
  finally { if (version === optionsVersion) optionsLoading.value = false }
}
async function openCreateStocktake() {
  if (pendingStocktake.value || stocktakeBusy.value) return
  stocktakeOperation.clearFeedback()
  Object.assign(stocktakeForm, { warehouseCode: warehouseCode.value || warehouses.value[0]?.warehouseCode || '', mode: 'location', blindCount: true, locationIds: [], skusText: '', sampleSize: 20, customerCode: '', inboundNo: '', inboundDateRange: [], remark: '' })
  stocktakeDialog.value = true
  await onStocktakeWarehouseChange(stocktakeForm.warehouseCode)
}
async function createStocktake() {
  const skus = stocktakeForm.skusText.split(/[\s,，]+/).map((v: string) => v.trim()).filter(Boolean)
  const { inboundDateRange, skusText: _skusText, ...payload } = stocktakeForm
  await stocktakeOperation.start('create', { ...payload, skus, inboundDateFrom: inboundDateRange?.[0], inboundDateTo: inboundDateRange?.[1] })
}
const openingPlan = ref(false), planError = ref('')
let planVersion = 0
async function openPlan(id: number) {
  if (stocktakeBusy.value) return
  const version = ++planVersion
  openingPlan.value = true; planError.value = ''
  stocktakeOperation.clearFeedback()
  try {
    const plan = await managementLoopApi.stocktake(id)
    if (version !== planVersion) return
    applyPlan(plan); countDialog.value = true
  } catch (error) {
    if (version === planVersion) { planError.value = userFacingError(error); ElMessage.error(`${planError.value} 可刷新盘点列表后重新打开。`) }
  } finally { if (version === planVersion) openingPlan.value = false }
}
function canCount(line: any) {
  return app.hasPerm('stocktake.count') && currentPlan.value?.status === 'counting' && ['pending', 'recount'].includes(line.status) && !(line.status === 'recount' && Number(line.firstCountedBy) === app.authenticatedUser?.id)
}
async function submitLine(line: any) {
  if (!canCount(line) || pendingStocktake.value) return
  if (!Number.isSafeInteger(line.inputQty) || line.inputQty < 0) { ElMessage.warning('请输入非负整数的实盘数量'); return }
  await stocktakeOperation.start('count', { lineId: line.id, qty: line.inputQty, expectedStage: line.status }, currentPlan.value.id)
}
async function approvePlan() {
  if (currentPlan.value?.status !== 'pending_approval' || !app.hasPerm('stocktake.approve')) return
  await stocktakeOperation.start('approve', {}, currentPlan.value.id)
}
function openTransition(action: 'cancel' | 'replan') {
  if (!planIsActive.value || !app.hasPerm('stocktake.approve') || (action === 'replan' && !app.hasPerm('stocktake.create')) || stocktakeBusy.value || pendingStocktake.value) return
  if (!currentPlan.value?.version) { ElMessage.warning('请先刷新盘点结果后继续'); return }
  stocktakeOperation.clearFeedback()
  Object.assign(transitionForm, { action, id: currentPlan.value.id, stocktakeNo: currentPlan.value.stocktakeNo, expectedVersion: currentPlan.value.version, reason: '' })
  transitionDialog.value = true
}
async function submitTransition() {
  if (!transitionForm.reason.trim()) { ElMessage.warning('请填写操作原因'); return }
  await stocktakeOperation.start(transitionForm.action, { expectedVersion: transitionForm.expectedVersion, reason: transitionForm.reason.trim() }, transitionForm.id)
}

const capacity = ref<any>({ items: [], warehouses: [], summary: {} })
const capDialog = ref(false)
const capForm = reactive({ id: 0, warehouseCode: '', warehouseName: '', totalVolumeCbm: null as number | null })
const canEditCapacity = computed(() => app.hasPerm('capacity.manage') || app.hasPerm('logistics_wh.manage'))
async function loadCapacity() {
  const code = warehouseCode.value
  await readPage('capacity', () => managementLoopApi.capacity({ warehouseCode: code || undefined }), data => { capacity.value = data })
}
function openWarehouseCap(row?: any) {
  if (savingCapacity.value) return
  if (!readLoaded.capacity || readErrors.capacity) { ElMessage.warning('请先成功读取容量数据，再设置仓级上限'); return }
  capacityFeedback.value = ''
  const fromOverview = row || (capacity.value.warehouses || []).find((item: any) => !warehouseCode.value || item.warehouseCode === warehouseCode.value) || capacity.value.warehouses?.[0]
  const listed = warehouses.value.find((wh) => (wh.warehouseCode || wh.code) === (fromOverview?.warehouseCode || warehouseCode.value))
  const target = fromOverview || listed
  if (!target) return ElMessage.warning('请先选择仓库')
  capForm.id = Number(target.id || listed?.id || 0)
  capForm.warehouseCode = target.warehouseCode || listed?.warehouseCode || listed?.code || ''
  capForm.warehouseName = target.warehouseName || listed?.warehouseName || listed?.name || capForm.warehouseCode
  capForm.totalVolumeCbm = target.capacitySet === false
    ? null
    : (target.totalVolumeCbm != null && target.totalVolumeCbm !== '' ? Number(target.totalVolumeCbm) : null)
  if (!capForm.id) return ElMessage.warning('找不到仓库记录')
  capDialog.value = true
}
const savingCapacity = ref(false), capacityFeedback = ref('')
const capacityRefresh = createCapacityRefresh({
  owner: () => String(app.authenticatedUser?.id || ''), storage: sessionStorage,
  send: attempt => managementLoopApi.refreshCapacityAlerts({ clientRequestId: attempt.requestId, warehouseCode: attempt.warehouseCode }),
  lookup: requestId => managementLoopApi.capacityRequest(requestId),
  applied: () => { void loadCapacity() },
})
const { pending: pendingCapacityRefresh, busy: refreshingAlerts, feedback: refreshFeedback } = capacityRefresh
onBeforeUnmount(capacityRefresh.stop)
async function saveWarehouseCap() {
  if (savingCapacity.value) return
  savingCapacity.value = true; capacityFeedback.value = ''
  try {
    await warehouseApi.updateCapacity(capForm.id, { totalVolumeCbm: capForm.totalVolumeCbm })
    capDialog.value = false; ElMessage.success('仓级上限已保存')
    await loadCapacity()
  } catch (error) { capacityFeedback.value = `${userFacingError(error)} 可保留输入后重新核对；保存为绝对目标值。` }
  finally { savingCapacity.value = false }
}
async function refreshAlerts() {
  await capacityRefresh.start(warehouseCode.value || undefined)
}

async function loadCurrent() {
  if (activeTab.value === 'reports') await loadReports()
  if (activeTab.value === 'stocktake') await loadStocktakes()
  if (activeTab.value === 'capacity') await loadCapacity()
}

async function reloadCurrent() {
  await readPage('warehouses', () => warehouseApi.list({ type: 'overseas' }), rows => { warehouses.value = (Array.isArray(rows) ? rows : rows.items || []).map(mapWarehouse) })
  await loadCurrent()
}
onMounted(reloadCurrent)
watch(() => route.path, loadCurrent)
watch(warehouseCode, loadCurrent)
</script>

<template>
  <div class="management-loop-page">
    <el-alert v-if="activeTab !== 'capacity' && pendingCapacityRefresh" title="有一次容量刷新结果尚待核对" type="info" :closable="false"><el-button @click="router.push('/wms/capacity')">继续核对容量刷新</el-button></el-alert>
    <el-alert v-if="readErrors.warehouses || readErrors[activeTab]" type="warning" :closable="false" :title="readErrors.warehouses || readErrors[activeTab]">
      <el-button size="small" :loading="loading" @click="reloadCurrent">重新查询</el-button><el-button size="small" @click="router.push('/dashboard')">返回工作台</el-button>
    </el-alert>
    <el-alert v-if="stocktakeFeedback && !stocktakeDialog && !countDialog && (activeTab === 'stocktake' || pendingStocktake)" type="info" :closable="false" :title="stocktakeFeedback">
      <template v-if="pendingStocktake"><el-button :loading="stocktakeBusy" @click="stocktakeOperation.reconcile">核对提交结果</el-button><el-button :loading="stocktakeBusy" @click="stocktakeOperation.retry">重试原提交</el-button></template>
    </el-alert>
    <el-card class="head-card">
      <div class="page-head">
        <div><h2>仓储管理闭环</h2><p>报表、盘点和容量使用同一套业务数据；盘点在 ERP 网页录入实盘，无独立 PDA 盘点端</p></div>
        <el-select v-model="warehouseCode" clearable placeholder="全部仓库" style="width: 220px">
          <el-option v-for="wh in warehouses" :key="wh.warehouseCode || wh.code" :label="wh.warehouseName || wh.name" :value="wh.warehouseCode || wh.code" />
        </el-select>
      </div>
      <el-tabs :model-value="activeTab" @tab-change="switchTab">
        <el-tab-pane v-for="tab in visibleTabs" :key="tab.key" :name="tab.key" :label="tab.label" />
      </el-tabs>
    </el-card>

    <template v-if="activeTab === 'reports'">
      <el-card v-loading="loading">
        <div class="toolbar">
          <div class="toolbar-filters">
            <el-radio-group :model-value="rangePreset" size="small" @update:model-value="applyPreset">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="today">今日</el-radio-button>
              <el-radio-button value="week">本周</el-radio-button>
              <el-radio-button value="month">本月</el-radio-button>
            </el-radio-group>
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              @change="onDateRangeChange"
            />
            <el-button type="primary" @click="loadReports">查询</el-button>
          </div>
          <div v-if="app.hasPerm('wms_reports.export')"><el-button :loading="exporting" @click="exportReports('inbound')">导出入库 CSV</el-button><el-button :loading="exporting" @click="exportReports('outbound')">导出出库 CSV</el-button></div>
        </div>
        <div v-if="readLoaded[activeTab]" class="metrics">
          <div class="metric"><span>入库单</span><strong>{{ reportSummary.inbound?.orderCount || 0 }}</strong><small>完成率 {{ reportSummary.inbound?.completionRate || 0 }}%</small></div>
          <div class="metric"><span>实收入库</span><strong>{{ reportSummary.inbound?.receivedQty || 0 }}</strong><small>差异 {{ reportSummary.inbound?.varianceQty || 0 }}</small></div>
          <div class="metric"><span>入库体积</span><strong>{{ formatCbm(reportSummary.inbound?.cbm) }}</strong><small>CBM · 实收优先</small></div>
          <div class="metric"><span>入库费用</span><strong>{{ formatMoney(reportSummary.inbound?.feeAmount) }}</strong><small>来自入库计费记录</small></div>
          <div class="metric"><span>出库单</span><strong>{{ reportSummary.outbound?.orderCount || 0 }}</strong><small>履约率 {{ reportSummary.outbound?.fulfillmentRate || 0 }}%</small></div>
          <div class="metric"><span>出库体积</span><strong>{{ formatCbm(reportSummary.outbound?.cbm) }}</strong><small>CBM · 已拣优先</small></div>
          <div class="metric"><span>出库费用</span><strong>{{ formatMoney(reportSummary.outbound?.feeAmount) }}</strong><small>来自出库计费记录</small></div>
        </div>
        <el-tabs>
          <el-tab-pane :label="`入库真实报表 (${readLoaded.reports ? inboundTotal : '待读取'})`">
            <el-table :data="inboundRows" :empty-text="readErrors.reports ? '未能读取报表，请重新查询' : '暂无数据'" stripe height="430">
              <el-table-column prop="inboundNo" label="入库单号" width="170" fixed />
              <el-table-column prop="warehouseCode" label="仓库" width="130" />
              <el-table-column prop="customerCode" label="客户" width="120" />
              <el-table-column label="状态" width="120"><template #default="s">{{ inboundStatus(s.row.status) }}</template></el-table-column>
              <el-table-column prop="expectedQty" label="应收" width="90" />
              <el-table-column prop="receivedQty" label="实收" width="90" />
              <el-table-column prop="putawayQty" label="上架" width="90" />
              <el-table-column prop="cartonCount" label="箱数" width="80" />
              <el-table-column label="CBM" width="110"><template #default="s">{{ formatCbm(s.row.cbm) }}</template></el-table-column>
              <el-table-column label="费用" width="110"><template #default="s">{{ formatMoney(s.row.feeAmount) }}</template></el-table-column>
              <el-table-column prop="receivedByName" label="收货人" width="110" />
              <el-table-column prop="qcByName" label="清点人" width="110" />
              <el-table-column label="到仓时间" min-width="160"><template #default="s">{{ formatTs(s.row.arrivedAt) }}</template></el-table-column>
              <el-table-column label="完成时间" min-width="160"><template #default="s">{{ formatTs(s.row.putawayAt) }}</template></el-table-column>
            </el-table>
            <p v-if="inboundTotal > inboundRows.length" class="hint">表格显示最近 {{ inboundRows.length }} 条，导出按相同筛选范围逐页读取全部记录</p>
          </el-tab-pane>
          <el-tab-pane :label="`出库真实报表 (${readLoaded.reports ? outboundTotal : '待读取'})`">
            <el-table :data="outboundRows" :empty-text="readErrors.reports ? '未能读取报表，请重新查询' : '暂无数据'" stripe height="430">
              <el-table-column prop="outboundNo" label="出库单号" width="170" fixed />
              <el-table-column prop="warehouseCode" label="仓库" width="130" />
              <el-table-column label="状态" width="120"><template #default="s">{{ outboundStatus(s.row.status) }}</template></el-table-column>
              <el-table-column prop="qty" label="订单件数" width="100" />
              <el-table-column prop="pickedQty" label="拣货件数" width="100" />
              <el-table-column label="CBM" width="110"><template #default="s">{{ formatCbm(s.row.cbm) }}</template></el-table-column>
              <el-table-column prop="carrier" label="承运商" width="130" />
              <el-table-column label="异常" width="130"><template #default="s">{{ exceptionType(s.row.exceptionType) }}</template></el-table-column>
              <el-table-column label="费用" width="110"><template #default="s">{{ formatMoney(s.row.feeAmount) }}</template></el-table-column>
              <el-table-column prop="pickerName" label="拣货人" width="110" />
              <el-table-column prop="reviewerName" label="复核人" width="110" />
              <el-table-column label="创建时间" min-width="160"><template #default="s">{{ formatTs(s.row.createdAt) }}</template></el-table-column>
              <el-table-column label="发运时间" min-width="160"><template #default="s">{{ formatTs(s.row.shippedAt) }}</template></el-table-column>
            </el-table>
            <p v-if="outboundTotal > outboundRows.length" class="hint">表格显示最近 {{ outboundRows.length }} 条，导出按相同筛选范围逐页读取全部记录</p>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>

    <el-card v-else-if="activeTab === 'stocktake'">
      <div class="toolbar"><div class="hint">可按客户、入库单号或入库时间收窄范围；打开盘点单后在网页按库位填写实盘数量并提交（非扫码枪/PDA 作业）</div><el-button v-if="app.hasPerm('stocktake.create')" :disabled="!!pendingStocktake || stocktakeBusy" type="primary" @click="openCreateStocktake">创建盘点</el-button></div>
      <el-button :loading="loading" @click="loadStocktakes">刷新盘点列表</el-button>
      <el-table :data="stocktakes" :empty-text="readErrors.stocktake ? '未能读取盘点列表，请重新查询' : '暂无盘点任务'" stripe v-loading="loading">
        <el-table-column prop="stocktakeNo" label="盘点单号" min-width="180" />
        <el-table-column prop="warehouseCode" label="仓库" width="140" />
        <el-table-column label="模式" width="90"><template #default="s">{{ stocktakeMode(s.row.mode) }}</template></el-table-column>
        <el-table-column label="范围" min-width="220"><template #default="s">{{ s.row.scopeLabel || '全范围' }}</template></el-table-column>
        <el-table-column prop="blindCount" label="盲盘" width="80"><template #default="s">{{ s.row.blindCount ? '是' : '否' }}</template></el-table-column>
        <el-table-column prop="lineCount" label="明细数" width="90" />
        <el-table-column label="状态" width="130"><template #default="s">{{ planStatus(s.row.status) }}</template></el-table-column>
        <el-table-column label="创建时间" min-width="170"><template #default="s">{{ formatTs(s.row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="100"><template #default="s"><el-button link type="primary" :loading="openingPlan" @click="openPlan(s.row.id)">打开</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-card v-else-if="activeTab === 'capacity'" v-loading="loading">
      <el-alert v-if="refreshFeedback" :title="refreshFeedback" type="info" :closable="false">
        <template v-if="pendingCapacityRefresh"><p>原刷新范围：{{ pendingCapacityRefresh.warehouseCode || '全部海外仓' }}</p><el-button :loading="refreshingAlerts" @click="capacityRefresh.reconcile">核对刷新结果</el-button><el-button :loading="refreshingAlerts" @click="capacityRefresh.retry">重试原刷新</el-button></template>
        <el-button :disabled="refreshingAlerts" @click="loadCapacity">查询当前容量</el-button>
      </el-alert>
      <div class="toolbar">
        <div class="hint">仓级预警按仓库总库容，不再用库位上限加总。库位行仍按各自上限。未设置仓级上限时不预警仓容。</div>
        <div>
          <el-button v-if="canEditCapacity" :disabled="loading || !readLoaded.capacity || !!readErrors.capacity" @click="openWarehouseCap()">设置仓级上限</el-button>
          <el-button v-if="app.hasPerm('capacity.manage')" :loading="refreshingAlerts" :disabled="!!pendingCapacityRefresh || savingCapacity" type="primary" @click="refreshAlerts">刷新预警</el-button>
        </div>
      </div>
      <div v-if="readLoaded[activeTab]" class="metrics">
        <div class="metric"><span>仓级上限</span><strong>{{ capacity.summary?.capacitySet ? `${capacity.summary.maxVolumeCbm} m³` : capacity.summary?.partiallyConfigured ? '部分未设置' : '未设置' }}</strong><small v-if="capacity.summary?.unsetWarehouseCount">{{ capacity.summary.unsetWarehouseCount }}个仓库未设置上限；请分别核对仓库行。</small><small>库位合计 {{ capacity.summary?.locationMaxVolumeCbm || 0 }} m³（仅参考）</small></div>
        <div class="metric"><span>已用体积</span><strong>{{ capacity.summary?.usedVolumeCbm || 0 }} m³</strong><small>{{ capacity.summary?.capacitySet ? `使用率 ${capacity.summary?.usageRate || 0}%` : '上限未齐，暂不汇总使用率' }}</small></div>
        <div class="metric"><span>预计仓级容量</span><strong>{{ capacity.summary?.capacitySet ? `${capacity.summary?.projectedRate || 0}%` : '待设置上限' }}</strong><small>待入库 {{ capacity.summary?.pendingVolumeCbm || 0 }} m³</small></div>
        <div class="metric"><span>尺寸缺失数量</span><strong>{{ capacity.summary?.unknownDimensionQty || 0 }}</strong><small>待入库 {{ capacity.summary?.pendingInboundQty || 0 }} 件 · 库位 {{ capacity.summary?.locationCount || 0 }}</small></div>
      </div>
      <el-table :data="capacity.warehouses || []" :empty-text="readErrors.capacity ? '未能读取仓库容量，请重新查询' : '暂无仓库记录'" stripe style="margin-bottom: 16px">
        <el-table-column prop="warehouseName" label="仓库" min-width="140" />
        <el-table-column label="仓级上限 m³" width="130"><template #default="s">{{ s.row.capacitySet ? s.row.totalVolumeCbm : '未设置' }}</template></el-table-column>
        <el-table-column prop="usedVolumeCbm" label="已用 m³" width="110" />
        <el-table-column prop="pendingVolumeCbm" label="待入库 m³" width="120" />
        <el-table-column label="仓级使用率" width="160"><template #default="s"><el-progress v-if="s.row.capacitySet" :percentage="Math.min(100, s.row.usageRate)" :status="s.row.usageRate >= 95 ? 'exception' : s.row.usageRate >= 80 ? 'warning' : 'success'" /><span v-else class="hint">未设置上限</span></template></el-table-column>
        <el-table-column label="预计 %" width="110"><template #default="s">{{ s.row.capacitySet ? s.row.projectedRate : '未设置上限' }}</template></el-table-column>
        <el-table-column prop="locationMaxVolumeCbm" label="库位合计 m³" width="120" />
        <el-table-column prop="alertLevel" label="仓级预警" width="110"><template #default="s"><el-tag :type="!s.row.capacitySet ? 'info' : s.row.alertLevel === 'critical' ? 'danger' : s.row.alertLevel === 'normal' ? 'success' : 'warning'">{{ s.row.capacitySet ? alertLevel(s.row.alertLevel) : '未设置上限' }}</el-tag></template></el-table-column>
        <el-table-column v-if="canEditCapacity" label="操作" width="90"><template #default="s"><el-button link type="primary" :disabled="loading || !!readErrors.capacity" @click="openWarehouseCap(s.row)">设置</el-button></template></el-table-column>
      </el-table>
      <el-table :data="capacity.items" :empty-text="readErrors.capacity ? '未能读取库位容量，请重新查询' : '暂无库位记录'" stripe height="420">
        <el-table-column prop="warehouseCode" label="仓库" width="130" />
        <el-table-column prop="zoneName" label="库区" width="110" />
        <el-table-column prop="locationCode" label="库位" width="150" />
        <el-table-column prop="usedVolumeCbm" label="已用体积 m³" width="120" />
        <el-table-column prop="maxVolumeCbm" label="最大体积 m³" width="120" />
        <el-table-column prop="volumeRate" label="体积使用率" width="150"><template #default="s"><el-progress :percentage="Math.min(100, s.row.volumeRate)" :status="s.row.volumeRate >= 95 ? 'exception' : s.row.volumeRate >= 80 ? 'warning' : 'success'" /></template></el-table-column>
        <el-table-column prop="weightRate" label="重量使用率" width="130" />
        <el-table-column prop="unknownDimensionQty" label="尺寸缺失" width="100" />
        <el-table-column prop="alertLevel" label="预警级别" width="110"><template #default="s"><el-tag :type="s.row.alertLevel === 'critical' ? 'danger' : s.row.alertLevel === 'normal' ? 'success' : 'warning'">{{ alertLevel(s.row.alertLevel) }}</el-tag></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="!stocktakeBusy" :show-close="!stocktakeBusy" v-model="stocktakeDialog" title="创建盘点计划" width="760px">
      <el-alert v-if="stocktakeFeedback && !transitionDialog" :title="stocktakeFeedback" type="info" :closable="false"><template v-if="pendingStocktake"><el-button :loading="stocktakeBusy" @click="stocktakeOperation.reconcile">核对提交结果</el-button><el-button :loading="stocktakeBusy" @click="stocktakeOperation.retry">重试原提交</el-button></template></el-alert>
      <el-alert v-if="stocktakeOptionsError" :title="stocktakeOptionsError" type="warning" :closable="false"><el-button @click="onStocktakeWarehouseChange(stocktakeForm.warehouseCode)">重读库位和客户</el-button></el-alert>
      <el-form :disabled="stocktakeBusy || !!pendingStocktake" :model="stocktakeForm" label-width="110px">
        <el-form-item label="仓库"><el-select v-model="stocktakeForm.warehouseCode" style="width:100%" @change="onStocktakeWarehouseChange"><el-option v-for="wh in warehouses" :key="wh.warehouseCode || wh.code" :label="wh.warehouseName || wh.name" :value="wh.warehouseCode || wh.code" /></el-select></el-form-item>
        <el-form-item label="盘点模式"><el-radio-group v-model="stocktakeForm.mode"><el-radio-button value="full">全仓</el-radio-button><el-radio-button value="location">库位</el-radio-button><el-radio-button value="sku">指定 SKU</el-radio-button><el-radio-button value="spot">抽盘</el-radio-button></el-radio-group></el-form-item>
        <el-form-item v-if="stocktakeForm.mode === 'location'" label="盘点库位"><el-select v-model="stocktakeForm.locationIds" multiple filterable style="width:100%"><el-option v-for="loc in locations" :key="loc.id" :label="loc.locationCode" :value="Number(loc.id)" /></el-select></el-form-item>
        <el-form-item v-if="stocktakeForm.mode === 'sku'" label="SKU"><el-input v-model="stocktakeForm.skusText" type="textarea" placeholder="多个 SKU 用逗号或换行分隔" /></el-form-item>
        <el-form-item v-if="stocktakeForm.mode === 'spot'" label="抽盘明细数"><el-input-number v-model="stocktakeForm.sampleSize" :min="1" :max="500" /></el-form-item>
        <el-form-item label="客户"><el-select v-model="stocktakeForm.customerCode" filterable clearable allow-create default-first-option placeholder="不限客户，可输入客户代码" style="width:100%"><el-option v-for="c in stocktakeCustomers" :key="c.customerCode" :label="c.customerCode" :value="c.customerCode" /></el-select></el-form-item>
        <el-form-item label="入库单号"><el-input v-model="stocktakeForm.inboundNo" clearable placeholder="按单盘点时填写，例如 RVAFU0430-260910-0002" /></el-form-item>
        <el-form-item label="入库时间"><el-date-picker v-model="stocktakeForm.inboundDateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:100%" /></el-form-item>
        <el-form-item label="盲盘"><el-switch v-model="stocktakeForm.blindCount" /><span class="form-tip">盘点过程中不向操作员显示账面数量</span></el-form-item>
        <el-form-item label="备注"><el-input v-model="stocktakeForm.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="stocktakeBusy" @click="stocktakeDialog = false">返回列表</el-button><el-button type="primary" :loading="stocktakeBusy" :disabled="!!pendingStocktake || optionsLoading || !!stocktakeOptionsError" @click="createStocktake">生成盘点任务</el-button></template>
    </el-dialog>

    <el-dialog top="5vh" @close="planVersion++" :close-on-click-modal="false" :close-on-press-escape="!stocktakeBusy" :show-close="!stocktakeBusy" v-model="countDialog" :title="`盘点单 ${currentPlan?.stocktakeNo || ''}`" width="1000px">
      <el-alert v-if="stocktakeFeedback && !transitionDialog" :title="stocktakeFeedback" type="info" :closable="false"><template v-if="pendingStocktake"><el-button :loading="stocktakeBusy" @click="stocktakeOperation.reconcile">核对提交结果</el-button><el-button :loading="stocktakeBusy" @click="stocktakeOperation.retry">重试原提交</el-button></template></el-alert>
      <el-alert v-if="planError" :title="planError" type="warning" :closable="false" />
      <el-alert v-if="currentPlan?.bookQtyHidden" title="盲盘模式：录入期间隐藏账面数量，待审批时显示供核对" type="info" :closable="false" />
      <el-alert v-if="currentPlan?.status === 'counting' && !app.hasPerm('stocktake.count')" title="当前账号可查看盘点，请交由有盘点权限的作业员录入数量" type="info" :closable="false" />
      <el-alert v-if="currentPlan?.status === 'pending_approval'" :title="app.hasPerm('stocktake.approve') ? '盘点已录入完成，请核对账面、实盘和差异后审批' : '盘点已录入完成，请交由有审批权限的账号核对并审批'" type="info" :closable="false" />
      <p v-if="currentPlan?.scopeLabel" class="hint" style="margin: 10px 0">范围 {{ currentPlan.scopeLabel }}</p>
      <p v-if="currentPlan?.scope?.replannedFromId" class="hint">本任务仅复制原商品、库位和批次明细，账面数量已重新读取；新增商品或库位请另建盘点。<el-button link type="primary" :disabled="stocktakeBusy || !!pendingStocktake" @click="openPlan(currentPlan.scope.replannedFromId)">查看原盘点 {{ currentPlan.scope.replannedFromNo }}</el-button></p>
      <p v-if="currentPlan?.status === 'cancelled'" class="hint">已取消，原计数保留且未调整库存。原因：{{ currentPlan.scope?.cancelReason || '未记录' }}<el-button v-if="currentPlan.scope?.replacementPlanId" link type="primary" :disabled="stocktakeBusy || !!pendingStocktake" @click="openPlan(currentPlan.scope.replacementPlanId)">继续新盘点 {{ currentPlan.scope.replacementPlanNo }}</el-button></p>
      <el-table :data="currentPlan?.lines || []" height="min(48vh, 520px)" stripe>
        <el-table-column prop="locationCode" label="库位" width="150" />
        <el-table-column prop="sku" label="SKU" min-width="160" />
        <el-table-column label="账面数量" width="100"><template #default="s">{{ currentPlan.bookQtyHidden ? '***' : s.row.bookQty }}</template></el-table-column>
        <el-table-column prop="firstQty" label="初盘" width="80" />
        <el-table-column prop="secondQty" label="复盘" width="80" />
        <el-table-column prop="varianceQty" label="差异" width="80" />
        <el-table-column label="状态" width="110"><template #default="s">{{ lineStatus(s.row.status) }}</template></el-table-column>
        <el-table-column v-if="currentPlan?.status === 'counting' && app.hasPerm('stocktake.count')" label="实盘数量" width="240" fixed="right"><template #default="s"><div v-if="canCount(s.row)" class="count-cell"><el-input-number :disabled="stocktakeBusy || !!pendingStocktake" v-model="s.row.inputQty" :min="0" size="small" /><el-button size="small" type="primary" :loading="stocktakeBusy" :disabled="!!pendingStocktake" @click="submitLine(s.row)">{{ s.row.status === 'recount' ? '提交复盘' : '提交初盘' }}</el-button></div><span v-else>{{ s.row.status === 'recount' ? '请交接其他作业员复盘' : '已提交' }}</span></template></el-table-column>
      </el-table>
      <template #footer>
        <el-button :disabled="stocktakeBusy" @click="countDialog = false">返回盘点列表</el-button>
        <el-button :loading="openingPlan" :disabled="stocktakeBusy" @click="openPlan(currentPlan.id)">刷新核对结果</el-button>
        <el-button v-if="planIsActive && app.hasPerm('stocktake.approve')" :disabled="stocktakeBusy || openingPlan || !!pendingStocktake" @click="openTransition('cancel')">取消盘点</el-button>
        <el-button v-if="planIsActive && app.hasPerm('stocktake.approve') && app.hasPerm('stocktake.create')" :disabled="stocktakeBusy || openingPlan || !!pendingStocktake" @click="openTransition('replan')">复制原明细重新盘点</el-button>
        <el-button v-if="currentPlan?.status === 'pending_approval' && app.hasPerm('stocktake.approve')" type="danger" :loading="stocktakeBusy" :disabled="!!pendingStocktake" @click="approvePlan">审批并调整库存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="transitionDialog" :title="transitionTitle" width="600px" append-to-body :close-on-click-modal="false" :close-on-press-escape="!stocktakeBusy" :show-close="!stocktakeBusy">
      <el-alert v-if="stocktakeFeedback" :title="stocktakeFeedback" type="info" :closable="false"><template v-if="pendingStocktake"><el-button :loading="stocktakeBusy" @click="stocktakeOperation.reconcile">核对提交结果</el-button><el-button :loading="stocktakeBusy" @click="stocktakeOperation.retry">重试原提交</el-button></template></el-alert>
      <p>{{ transitionForm.stocktakeNo }}</p>
      <p>{{ transitionForm.action === 'replan' ? '旧盘点将取消并保留计数；新任务沿用原商品、库位及批次范围，重新读取账面数量，不包含后来新增的明细。请重新清点，新任务审批前不调整库存。' : '取消后保留原计数和审计记录，不调整库存。已完成的盘点不能取消。' }}</p>
      <el-form :disabled="stocktakeBusy || !!pendingStocktake" label-width="80px"><el-form-item label="操作原因" required><el-input v-model="transitionForm.reason" aria-label="操作原因" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item></el-form>
      <template #footer><el-button :disabled="stocktakeBusy" @click="transitionDialog = false">返回盘点单</el-button><el-button type="primary" :loading="stocktakeBusy" :disabled="!!pendingStocktake" @click="submitTransition">{{ transitionForm.action === 'replan' ? '确认并继续新盘点' : '确认取消盘点' }}</el-button></template>
    </el-dialog>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="!savingCapacity" :show-close="!savingCapacity" v-model="capDialog" :title="`仓级上限 · ${capForm.warehouseName || capForm.warehouseCode}`" width="480px">
      <el-alert v-if="capacityFeedback" :title="capacityFeedback" type="warning" :closable="false" />
      <el-form :disabled="savingCapacity" label-width="110px">
        <el-form-item label="仓库">{{ capForm.warehouseCode }}</el-form-item>
        <el-form-item label="总库容 m³">
          <el-input-number v-model="capForm.totalVolumeCbm" :min="0" :precision="4" :step="10" controls-position="right" style="width:100%" />
          <div class="form-tip" style="margin-left:0">例如 500。清空表示未设置，预警不再用库位加总冒充总库容。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="savingCapacity" @click="capDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingCapacity" @click="saveWarehouseCap">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.management-loop-page { display: grid; gap: 16px; }
.head-card :deep(.el-card__body) { padding-bottom: 0; }
.page-head, .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-head h2 { margin: 0 0 5px; font-size: 22px; color: #17223b; }
.page-head p, .hint { margin: 0; color: #768196; font-size: 13px; }
.toolbar { margin-bottom: 18px; flex-wrap: wrap; }
.toolbar-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin: 18px 0; }
.metric { border: 1px solid #e7eaf2; border-radius: 10px; padding: 16px; background: #fafbfe; display: grid; gap: 7px; }
.metric span, .metric small { color: #7a8498; }
.metric strong { font-size: 24px; color: #1c2944; }
.form-tip { margin-left: 10px; color: #9099aa; font-size: 12px; }
.count-cell { display: flex; align-items: center; gap: 6px; }
.count-cell :deep(.el-input-number) { width: 110px; flex: 0 0 110px; }
@media (max-width: 900px) { .metrics { grid-template-columns: repeat(2, 1fr); } .page-head { align-items: flex-start; flex-direction: column; } }
</style>
