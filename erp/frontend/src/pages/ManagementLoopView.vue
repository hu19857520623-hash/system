<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { locationApi, managementLoopApi, warehouseApi } from '@/api/client.js'
import { mapWarehouse } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'
import { downloadCsv } from '@/utils/csv.ts'

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const activeTab = computed(() => String(route.meta.tab || 'reports'))
const loading = ref(false)
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
  if (tab) router.push(tab.path)
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
  loading.value = true
  try {
    const [summary, inbound, outbound] = await Promise.all([
      managementLoopApi.reportSummary(reportParams()),
      managementLoopApi.inboundReport(reportParams()),
      managementLoopApi.outboundReport(reportParams()),
    ])
    reportSummary.value = summary
    inboundRows.value = inbound.items || []
    outboundRows.value = outbound.items || []
    inboundTotal.value = inbound.total || 0
    outboundTotal.value = outbound.total || 0
  } finally { loading.value = false }
}

async function exportReports() {
  exporting.value = true
  try {
    const [inbound, outbound] = await Promise.all([
      managementLoopApi.inboundReport(reportParams(5000)),
      managementLoopApi.outboundReport(reportParams(5000)),
    ])
    const inboundItems = inbound.items || []
    const outboundItems = outbound.items || []
    if (!inboundItems.length && !outboundItems.length) {
      ElMessage.warning('当前区间没有可导出的数据')
      return
    }
    const stamp = ymd(new Date())
    if (inboundItems.length) {
      downloadCsv(`入库作业报表_${stamp}.csv`, [
        '入库单号', '仓库', '客户', '状态', '应收', '实收', '上架', '箱数', 'CBM', '费用', '收货人', '清点人', '到仓时间', '完成时间',
      ], inboundItems.map((row: any) => [
        row.inboundNo, row.warehouseCode, row.customerCode, row.status,
        row.expectedQty, row.receivedQty, row.putawayQty, row.cartonCount,
        formatCbm(row.cbm), Number(row.feeAmount || 0).toFixed(2),
        row.receivedByName, row.qcByName, formatTs(row.arrivedAt), formatTs(row.putawayAt),
      ]))
    }
    if (outboundItems.length) {
      downloadCsv(`出库作业报表_${stamp}.csv`, [
        '出库单号', '仓库', '状态', '订单件数', '拣货件数', 'CBM', '承运商', '异常', '费用', '拣货人', '复核人', '创建时间', '发运时间',
      ], outboundItems.map((row: any) => [
        row.outboundNo, row.warehouseCode, row.status, row.qty, row.pickedQty,
        formatCbm(row.cbm), row.carrier, row.exceptionType,
        Number(row.feeAmount || 0).toFixed(2), row.pickerName, row.reviewerName,
        formatTs(row.createdAt), formatTs(row.shippedAt),
      ]))
    }
    ElMessage.success('报表已导出')
  } finally { exporting.value = false }
}

const stocktakes = ref<any[]>([])
const stocktakeDialog = ref(false)
const countDialog = ref(false)
const locations = ref<any[]>([])
const stocktakeCustomers = ref<{ customerCode: string }[]>([])
const currentPlan = ref<any>(null)
const stocktakeForm = reactive<any>({
  warehouseCode: '', mode: 'location', blindCount: true, locationIds: [], skusText: '', sampleSize: 20,
  customerCode: '', inboundNo: '', inboundDateRange: [] as string[], remark: '',
})
const stocktakeModeLabel: Record<string, string> = { full: '全仓', location: '库位', sku: 'SKU', spot: '抽盘' }

async function loadStocktakes() { stocktakes.value = await managementLoopApi.stocktakes({ warehouseCode: warehouseCode.value || undefined }) }
async function loadLocations(code: string) {
  if (!code) { locations.value = []; return }
  const result = await locationApi.list({ warehouseCode: code })
  locations.value = Array.isArray(result) ? result : result.items || []
}
async function loadStocktakeOptions(code: string) {
  if (!code || !app.hasPerm('stocktake.create')) { stocktakeCustomers.value = []; return }
  const options = await managementLoopApi.stocktakeOptions({ warehouseCode: code })
  stocktakeCustomers.value = options.customers || []
}
async function onStocktakeWarehouseChange(code: string) {
  await Promise.all([loadLocations(code), loadStocktakeOptions(code)])
}
async function openCreateStocktake() {
  stocktakeForm.warehouseCode = warehouseCode.value || warehouses.value[0]?.warehouseCode || warehouses.value[0]?.code || ''
  stocktakeForm.mode = 'location'
  stocktakeForm.blindCount = true
  stocktakeForm.locationIds = []
  stocktakeForm.skusText = ''
  stocktakeForm.sampleSize = 20
  stocktakeForm.customerCode = ''
  stocktakeForm.inboundNo = ''
  stocktakeForm.inboundDateRange = []
  stocktakeForm.remark = ''
  await onStocktakeWarehouseChange(stocktakeForm.warehouseCode)
  stocktakeDialog.value = true
}
async function createStocktake() {
  const skus = stocktakeForm.skusText.split(/[\s,，]+/).map((v: string) => v.trim()).filter(Boolean)
  const { inboundDateRange, skusText: _skusText, ...payload } = stocktakeForm
  const result = await managementLoopApi.createStocktake({
    ...payload,
    skus,
    inboundDateFrom: inboundDateRange?.[0],
    inboundDateTo: inboundDateRange?.[1],
  })
  ElMessage.success(`盘点单 ${result.stocktakeNo} 已创建`)
  stocktakeDialog.value = false
  await loadStocktakes()
  await openPlan(result.id)
}
async function openPlan(id: number) {
  currentPlan.value = await managementLoopApi.stocktake(id)
  countDialog.value = true
}
async function submitLine(line: any) {
  if (line.inputQty === '' || line.inputQty == null) return ElMessage.warning('请输入实盘数量')
  currentPlan.value = await managementLoopApi.countStocktake(currentPlan.value.id, { lineId: line.id, qty: Number(line.inputQty) })
  ElMessage.success(line.firstQty == null ? '初盘已提交' : '复盘已提交')
}
async function approvePlan() {
  currentPlan.value = await managementLoopApi.approveStocktake(currentPlan.value.id)
  ElMessage.success('盘点差异已审批并写入库存流水')
  await loadStocktakes()
}

const capacity = ref<any>({ items: [], warehouses: [], summary: {} })
const capDialog = ref(false)
const capForm = reactive({ id: 0, warehouseCode: '', warehouseName: '', totalVolumeCbm: null as number | null })
const canEditCapacity = computed(() => app.hasPerm('capacity.manage') || app.hasPerm('logistics_wh.manage'))
async function loadCapacity() {
  loading.value = true
  try { capacity.value = await managementLoopApi.capacity({ warehouseCode: warehouseCode.value || undefined }) }
  finally { loading.value = false }
}
function openWarehouseCap(row?: any) {
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
async function saveWarehouseCap() {
  await warehouseApi.updateCapacity(capForm.id, { totalVolumeCbm: capForm.totalVolumeCbm })
  ElMessage.success(`${capForm.warehouseName} 仓级上限已保存`)
  capDialog.value = false
  const warehouseResult = await warehouseApi.list({ type: 'overseas' })
  warehouses.value = (Array.isArray(warehouseResult) ? warehouseResult : warehouseResult.items || []).map(mapWarehouse)
  await loadCapacity()
}
async function refreshAlerts() {
  const result = await managementLoopApi.refreshCapacityAlerts({ warehouseCode: warehouseCode.value || undefined })
  ElMessage.success(`已刷新，当前生成 ${result.refreshed} 条预警`)
  await loadCapacity()
}

async function loadCurrent() {
  if (activeTab.value === 'reports') await loadReports()
  if (activeTab.value === 'stocktake') await loadStocktakes()
  if (activeTab.value === 'capacity') await loadCapacity()
}

onMounted(async () => {
  const warehouseResult = await warehouseApi.list({ type: 'overseas' })
  warehouses.value = (Array.isArray(warehouseResult) ? warehouseResult : warehouseResult.items || []).map(mapWarehouse)
  await loadCurrent()
})
watch(() => route.path, loadCurrent)
watch(warehouseCode, loadCurrent)
</script>

<template>
  <div class="management-loop-page">
    <el-card class="head-card">
      <div class="page-head">
        <div><h2>仓储管理闭环</h2><p>报表、盘点和容量使用同一套真实业务数据</p></div>
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
          <el-button :loading="exporting" @click="exportReports">导出 CSV</el-button>
        </div>
        <div class="metrics">
          <div class="metric"><span>入库单</span><strong>{{ reportSummary.inbound?.orderCount || 0 }}</strong><small>完成率 {{ reportSummary.inbound?.completionRate || 0 }}%</small></div>
          <div class="metric"><span>实收入库</span><strong>{{ reportSummary.inbound?.receivedQty || 0 }}</strong><small>差异 {{ reportSummary.inbound?.varianceQty || 0 }}</small></div>
          <div class="metric"><span>入库体积</span><strong>{{ formatCbm(reportSummary.inbound?.cbm) }}</strong><small>CBM · 实收优先</small></div>
          <div class="metric"><span>入库费用</span><strong>{{ formatMoney(reportSummary.inbound?.feeAmount) }}</strong><small>来自 billing_charge</small></div>
          <div class="metric"><span>出库单</span><strong>{{ reportSummary.outbound?.orderCount || 0 }}</strong><small>履约率 {{ reportSummary.outbound?.fulfillmentRate || 0 }}%</small></div>
          <div class="metric"><span>出库体积</span><strong>{{ formatCbm(reportSummary.outbound?.cbm) }}</strong><small>CBM · 已拣优先</small></div>
          <div class="metric"><span>出库费用</span><strong>{{ formatMoney(reportSummary.outbound?.feeAmount) }}</strong><small>来自 billing_charge</small></div>
        </div>
        <el-tabs>
          <el-tab-pane :label="`入库真实报表 (${inboundTotal})`">
            <el-table :data="inboundRows" stripe height="430">
              <el-table-column prop="inboundNo" label="入库单号" width="170" fixed />
              <el-table-column prop="warehouseCode" label="仓库" width="130" />
              <el-table-column prop="customerCode" label="客户" width="120" />
              <el-table-column prop="status" label="状态" width="120" />
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
            <p v-if="inboundTotal > inboundRows.length" class="hint">表格显示最近 {{ inboundRows.length }} 条，导出可含全部 {{ inboundTotal }} 条</p>
          </el-tab-pane>
          <el-tab-pane :label="`出库真实报表 (${outboundTotal})`">
            <el-table :data="outboundRows" stripe height="430">
              <el-table-column prop="outboundNo" label="出库单号" width="170" fixed />
              <el-table-column prop="warehouseCode" label="仓库" width="130" />
              <el-table-column prop="status" label="状态" width="120" />
              <el-table-column prop="qty" label="订单件数" width="100" />
              <el-table-column prop="pickedQty" label="拣货件数" width="100" />
              <el-table-column label="CBM" width="110"><template #default="s">{{ formatCbm(s.row.cbm) }}</template></el-table-column>
              <el-table-column prop="carrier" label="承运商" width="130" />
              <el-table-column prop="exceptionType" label="异常" width="130" />
              <el-table-column label="费用" width="110"><template #default="s">{{ formatMoney(s.row.feeAmount) }}</template></el-table-column>
              <el-table-column prop="pickerName" label="拣货人" width="110" />
              <el-table-column prop="reviewerName" label="复核人" width="110" />
              <el-table-column label="创建时间" min-width="160"><template #default="s">{{ formatTs(s.row.createdAt) }}</template></el-table-column>
              <el-table-column label="发运时间" min-width="160"><template #default="s">{{ formatTs(s.row.shippedAt) }}</template></el-table-column>
            </el-table>
            <p v-if="outboundTotal > outboundRows.length" class="hint">表格显示最近 {{ outboundRows.length }} 条，导出可含全部 {{ outboundTotal }} 条</p>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>

    <el-card v-else-if="activeTab === 'stocktake'">
      <div class="toolbar"><div class="hint">可按客户、入库单号或入库时间收窄范围；PDA 扫盘点单号后按库位清点</div><el-button v-if="app.hasPerm('stocktake.create')" type="primary" @click="openCreateStocktake">创建盘点</el-button></div>
      <el-table :data="stocktakes" stripe>
        <el-table-column prop="stocktakeNo" label="盘点单号" min-width="180" />
        <el-table-column prop="warehouseCode" label="仓库" width="140" />
        <el-table-column label="模式" width="90"><template #default="s">{{ stocktakeModeLabel[s.row.mode] || s.row.mode }}</template></el-table-column>
        <el-table-column label="范围" min-width="220"><template #default="s">{{ s.row.scopeLabel || '全范围' }}</template></el-table-column>
        <el-table-column prop="blindCount" label="盲盘" width="80"><template #default="s">{{ s.row.blindCount ? '是' : '否' }}</template></el-table-column>
        <el-table-column prop="lineCount" label="明细数" width="90" />
        <el-table-column prop="status" label="状态" width="130" />
        <el-table-column prop="createdAt" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="100"><template #default="s"><el-button link type="primary" @click="openPlan(s.row.id)">打开</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-card v-else-if="activeTab === 'capacity'" v-loading="loading">
      <div class="toolbar">
        <div class="hint">仓级预警按仓库总库容，不再用库位上限加总。库位行仍按各自上限。未设置仓级上限时不预警仓容。</div>
        <div>
          <el-button v-if="canEditCapacity" @click="openWarehouseCap()">设置仓级上限</el-button>
          <el-button v-if="app.hasPerm('capacity.manage')" type="primary" @click="refreshAlerts">刷新预警</el-button>
        </div>
      </div>
      <div class="metrics">
        <div class="metric"><span>仓级上限</span><strong>{{ capacity.summary?.capacitySet ? `${capacity.summary.maxVolumeCbm} m³` : '未设置' }}</strong><small>库位合计 {{ capacity.summary?.locationMaxVolumeCbm || 0 }} m³（仅参考）</small></div>
        <div class="metric"><span>已用体积</span><strong>{{ capacity.summary?.usedVolumeCbm || 0 }} m³</strong><small>使用率 {{ capacity.summary?.usageRate || 0 }}%</small></div>
        <div class="metric"><span>预计仓级容量</span><strong>{{ capacity.summary?.projectedRate || 0 }}%</strong><small>待入库 {{ capacity.summary?.pendingVolumeCbm || 0 }} m³</small></div>
        <div class="metric"><span>尺寸缺失数量</span><strong>{{ capacity.summary?.unknownDimensionQty || 0 }}</strong><small>待入库 {{ capacity.summary?.pendingInboundQty || 0 }} 件 · 库位 {{ capacity.summary?.locationCount || 0 }}</small></div>
      </div>
      <el-table :data="capacity.warehouses || []" stripe style="margin-bottom: 16px">
        <el-table-column prop="warehouseName" label="仓库" min-width="140" />
        <el-table-column label="仓级上限 m³" width="130"><template #default="s">{{ s.row.capacitySet ? s.row.totalVolumeCbm : '未设置' }}</template></el-table-column>
        <el-table-column prop="usedVolumeCbm" label="已用 m³" width="110" />
        <el-table-column prop="pendingVolumeCbm" label="待入库 m³" width="120" />
        <el-table-column label="仓级使用率" width="160"><template #default="s"><el-progress v-if="s.row.capacitySet" :percentage="Math.min(100, s.row.usageRate)" :status="s.row.usageRate >= 95 ? 'exception' : s.row.usageRate >= 80 ? 'warning' : 'success'" /><span v-else class="hint">未设置上限</span></template></el-table-column>
        <el-table-column prop="projectedRate" label="预计 %" width="90" />
        <el-table-column prop="locationMaxVolumeCbm" label="库位合计 m³" width="120" />
        <el-table-column prop="alertLevel" label="仓级预警" width="110"><template #default="s"><el-tag :type="s.row.alertLevel === 'critical' ? 'danger' : s.row.alertLevel === 'normal' ? 'success' : 'warning'">{{ s.row.alertLevel }}</el-tag></template></el-table-column>
        <el-table-column v-if="canEditCapacity" label="操作" width="90"><template #default="s"><el-button link type="primary" @click="openWarehouseCap(s.row)">设置</el-button></template></el-table-column>
      </el-table>
      <el-table :data="capacity.items" stripe height="420">
        <el-table-column prop="warehouseCode" label="仓库" width="130" />
        <el-table-column prop="zoneName" label="库区" width="110" />
        <el-table-column prop="locationCode" label="库位" width="150" />
        <el-table-column prop="usedVolumeCbm" label="已用体积 m³" width="120" />
        <el-table-column prop="maxVolumeCbm" label="最大体积 m³" width="120" />
        <el-table-column prop="volumeRate" label="体积使用率" width="150"><template #default="s"><el-progress :percentage="Math.min(100, s.row.volumeRate)" :status="s.row.volumeRate >= 95 ? 'exception' : s.row.volumeRate >= 80 ? 'warning' : 'success'" /></template></el-table-column>
        <el-table-column prop="weightRate" label="重量使用率" width="130" />
        <el-table-column prop="unknownDimensionQty" label="尺寸缺失" width="100" />
        <el-table-column prop="alertLevel" label="预警级别" width="110"><template #default="s"><el-tag :type="s.row.alertLevel === 'critical' ? 'danger' : s.row.alertLevel === 'normal' ? 'success' : 'warning'">{{ s.row.alertLevel }}</el-tag></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="stocktakeDialog" title="创建盘点计划" width="760px">
      <el-form :model="stocktakeForm" label-width="110px">
        <el-form-item label="仓库"><el-select v-model="stocktakeForm.warehouseCode" style="width:100%" @change="onStocktakeWarehouseChange"><el-option v-for="wh in warehouses" :key="wh.warehouseCode || wh.code" :label="wh.warehouseName || wh.name" :value="wh.warehouseCode || wh.code" /></el-select></el-form-item>
        <el-form-item label="盘点模式"><el-radio-group v-model="stocktakeForm.mode"><el-radio-button value="full">全仓</el-radio-button><el-radio-button value="location">库位</el-radio-button><el-radio-button value="sku">指定 SKU</el-radio-button><el-radio-button value="spot">抽盘</el-radio-button></el-radio-group></el-form-item>
        <el-form-item v-if="stocktakeForm.mode === 'location'" label="盘点库位"><el-select v-model="stocktakeForm.locationIds" multiple filterable style="width:100%"><el-option v-for="loc in locations" :key="loc.id" :label="loc.locationCode" :value="Number(loc.id)" /></el-select></el-form-item>
        <el-form-item v-if="stocktakeForm.mode === 'sku'" label="SKU"><el-input v-model="stocktakeForm.skusText" type="textarea" placeholder="多个 SKU 用逗号或换行分隔" /></el-form-item>
        <el-form-item v-if="stocktakeForm.mode === 'spot'" label="抽盘明细数"><el-input-number v-model="stocktakeForm.sampleSize" :min="1" :max="500" /></el-form-item>
        <el-form-item label="客户"><el-select v-model="stocktakeForm.customerCode" filterable clearable allow-create default-first-option placeholder="不限客户，可输入客户代码" style="width:100%"><el-option v-for="c in stocktakeCustomers" :key="c.customerCode" :label="c.customerCode" :value="c.customerCode" /></el-select></el-form-item>
        <el-form-item label="入库单号"><el-input v-model="stocktakeForm.inboundNo" clearable placeholder="按单盘点时填写，例如 IN-20260903-0001" /></el-form-item>
        <el-form-item label="入库时间"><el-date-picker v-model="stocktakeForm.inboundDateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:100%" /></el-form-item>
        <el-form-item label="盲盘"><el-switch v-model="stocktakeForm.blindCount" /><span class="form-tip">盘点过程中不向操作员显示账面数量</span></el-form-item>
        <el-form-item label="备注"><el-input v-model="stocktakeForm.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="stocktakeDialog = false">取消</el-button><el-button type="primary" @click="createStocktake">生成盘点任务</el-button></template>
    </el-dialog>

    <el-dialog v-model="countDialog" :title="`盘点单 ${currentPlan?.stocktakeNo || ''}`" width="1000px">
      <el-alert v-if="currentPlan?.blindCount && currentPlan?.status !== 'completed'" title="盲盘模式：账面数量在审批完成前隐藏" type="info" :closable="false" />
      <p v-if="currentPlan?.scopeLabel" class="hint" style="margin: 10px 0">范围 {{ currentPlan.scopeLabel }}</p>
      <el-table :data="currentPlan?.lines || []" height="520" stripe>
        <el-table-column prop="locationCode" label="库位" width="150" />
        <el-table-column prop="sku" label="SKU" min-width="160" />
        <el-table-column label="账面数量" width="100"><template #default="s">{{ currentPlan.blindCount && currentPlan.status !== 'completed' ? '***' : s.row.bookQty }}</template></el-table-column>
        <el-table-column prop="firstQty" label="初盘" width="80" />
        <el-table-column prop="secondQty" label="复盘" width="80" />
        <el-table-column prop="varianceQty" label="差异" width="80" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column v-if="currentPlan?.status === 'counting'" label="实盘数量" width="200"><template #default="s"><div class="count-cell"><el-input-number v-model="s.row.inputQty" :min="0" size="small" /><el-button size="small" type="primary" @click="submitLine(s.row)">提交</el-button></div></template></el-table-column>
      </el-table>
      <template #footer><el-button @click="countDialog = false">关闭</el-button><el-button v-if="currentPlan?.status === 'pending_approval' && app.hasPerm('stocktake.approve')" type="danger" @click="approvePlan">审批并调整库存</el-button></template>
    </el-dialog>

    <el-dialog v-model="capDialog" :title="`仓级上限 · ${capForm.warehouseName || capForm.warehouseCode}`" width="480px">
      <el-form label-width="110px">
        <el-form-item label="仓库">{{ capForm.warehouseCode }}</el-form-item>
        <el-form-item label="总库容 m³">
          <el-input-number v-model="capForm.totalVolumeCbm" :min="0" :precision="4" :step="10" controls-position="right" style="width:100%" />
          <div class="form-tip" style="margin-left:0">例如 500。清空表示未设置，预警不再用库位加总冒充总库容。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="capDialog = false">取消</el-button>
        <el-button type="primary" @click="saveWarehouseCap">保存</el-button>
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
@media (max-width: 900px) { .metrics { grid-template-columns: repeat(2, 1fr); } .page-head { align-items: flex-start; flex-direction: column; } }
</style>
