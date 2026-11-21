<script setup lang="ts">
import { userFacingError } from '@erp/shared/user-facing-error'

import { displaySku, displaySkuText } from '@erp/shared/sku-display'
import { computed, ref, onMounted, onScopeDispose, watch } from 'vue'
import { getAccessToken } from '@/auth/tokenStore'
import { createReturnReadGate } from '@/utils/returnReadGate'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { inventoryApi } from '@/api/client.js'
import { fmtTime, fmtDate } from '@/api/mappers.ts'
import ListPagination from '@/components/ListPagination.vue'
import { useAppStore } from '@/stores/app'
import DetailSheet from '@/components/ui/DetailSheet.vue'

const router = useRouter()
const route = useRoute()
const app = useAppStore()
const tableRef = ref<TableInstance>()
const loading = ref(false)
const loadError = ref('')
function queryScope() {
  const token = getAccessToken()
  const user = app.authenticatedUser
  return token && user ? JSON.stringify([token, user.id, user.roleCode, [...app.currentPermSet].sort()]) : null
}
const listGate = createReturnReadGate(queryScope)
const historyGate = createReturnReadGate(queryScope)
const canReadHistory = computed(() => app.hasPerm('inventory_query.view') || app.hasPerm('inventory_query.detail'))
let lastQuery: Record<string, unknown> | null = null
const rows = ref<any[]>([])
const listTotal = ref(0)
const sourceLabels = { erp: '货盘', oms: 'OMS' } as const
const sourceTabs = [
  { value: 'all', label: '全部' },
  { value: 'erp', label: 'ERP 海外仓' },
  { value: 'oms', label: 'OMS 客户' },
] as const
type SkuSource = typeof sourceTabs[number]['value']
const sourceCounts = ref<Record<SkuSource, number> | null>(null)
const page = ref(1)
const pageSize = ref(20)
const selectedRows = ref<any[]>([])
const detailVisible = ref(false)
const detailRow = ref<any>(null)
const historyRow = ref<{ sku: string; customerSku?: string } | null>(null)
const historyVisible = ref(false)
const historyEntries = ref<any[]>([])
const historyError = ref('')
const historyLoading = ref(false)
const historyTotal = ref(0)
const historyPage = ref(1)
const historyPageSize = ref(20)
const historyTime = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const historyFieldLabels: Record<string, string> = {
  productName: '商品名', customerSku: '客户 SKU', spec: '规格', barcode: '条码', brand: '品牌', category: '品类', spu: 'SPU',
  weightKg: '重量 (kg)', costRmb: '申报成本', lengthCm: '申报长 (cm)', widthCm: '申报宽 (cm)', heightCm: '申报高 (cm)',
  measuredLengthCm: '实测长 (cm)', measuredWidthCm: '实测宽 (cm)', measuredHeightCm: '实测高 (cm)',
  marketPrice: '市场价', seaFreightPerUnit: '单件海运费', domesticFeePerUnit: '单件国内费用', remark: '备注', status: '状态',
}
const editVisible = ref(false)
const editRow = ref<any>(null)
const editSaving = ref(false)
const editForm = ref({
  productName: '',
  spec: '',
  barcode: '',
  brand: '',
  category: '',
  spu: '',
  weightKg: '' as string | number,
  costRmb: '' as string | number,
  lengthCm: '' as string | number,
  widthCm: '' as string | number,
  heightCm: '' as string | number,
  measuredLengthCm: '' as string | number,
  measuredWidthCm: '' as string | number,
  measuredHeightCm: '' as string | number,
})

const filters = ref({
  dataSource: 'erp' as SkuSource,
  supplierKeyword: '',
  title: '',
  skuCodes: '',
  barcode: '',
  costMin: '',
  costMax: '',
  category: '',
  brand: '',
  statusFilter: 'all',
  createdRange: [] as string[],
  updatedRange: [] as string[],
})

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '正式产品' },
  { value: 'pending', label: '待完善' },
  { value: 'inactive', label: '停用' },
  { value: 'missing_dims', label: '缺尺寸' },
]

function buildParams() {
  const p: Record<string, unknown> = {
    page: page.value,
    pageSize: pageSize.value,
    statusFilter: filters.value.statusFilter,
    dataSource: filters.value.dataSource,
    includeSourceCounts: 'true',
  }
  if (filters.value.dataSource !== 'oms' && filters.value.supplierKeyword.trim()) p.supplierKeyword = filters.value.supplierKeyword.trim()
  if (filters.value.title.trim()) p.title = filters.value.title.trim()
  if (filters.value.skuCodes.trim()) p.skuCodes = filters.value.skuCodes.trim()
  if (filters.value.barcode.trim()) p.barcode = filters.value.barcode.trim()
  if (filters.value.category.trim()) p.category = filters.value.category.trim()
  if (filters.value.brand.trim()) p.brand = filters.value.brand.trim()
  if (filters.value.costMin !== '') p.costMin = filters.value.costMin
  if (filters.value.costMax !== '') p.costMax = filters.value.costMax
  if (filters.value.createdRange?.length === 2) {
    p.createdFrom = filters.value.createdRange[0]
    p.createdTo = filters.value.createdRange[1]
  }
  if (filters.value.updatedRange?.length === 2) {
    p.updatedFrom = filters.value.updatedRange[0]
    p.updatedTo = filters.value.updatedRange[1]
  }
  return p
}

async function load(params = buildParams()) {
  lastQuery = params
  const active = listGate.begin(() => true)
  rows.value = []
  selectedRows.value = []
  tableRef.value?.clearSelection()
  loadError.value = ''
  if (!active()) {
    loading.value = false
    sourceCounts.value = null
    loadError.value = '请重新登录后查询商品'
    return
  }
  loading.value = true
  try {
    const res = await inventoryApi.skuQuery(params)
    if (!active()) return
    rows.value = res.items || []
    listTotal.value = res.total ?? 0
    sourceCounts.value = res.sourceCounts ?? null
  } catch (error) {
    if (active()) {
      sourceCounts.value = null
      loadError.value = `商品查询失败。${userFacingError(error)} 可重试原查询或调整筛选后查询。`
    }
  } finally {
    if (active()) loading.value = false
  }
}

function retryList() {
  void load(lastQuery ?? buildParams())
}

function search() {
  if (page.value === 1) void load()
  else page.value = 1
}

function resetFilters() {
  filters.value = {
    dataSource: 'erp',
    supplierKeyword: '',
    title: '',
    skuCodes: '',
    barcode: '',
    costMin: '',
    costMax: '',
    category: '',
    brand: '',
    statusFilter: 'all',
    createdRange: [],
    updatedRange: [],
  }
  search()
}

function rowIndex(index: number) {
  return (page.value - 1) * pageSize.value + index + 1
}

function onSelectionChange(val: any[]) {
  selectedRows.value = val
}

function openDetail(row: any) {
  detailRow.value = row
  detailVisible.value = true
}

function openHistory(sku: string, customerSku?: string) {
  historyRow.value = { sku, customerSku }
  historyVisible.value = true
  historyTotal.value = 0
  if (historyPage.value === 1) void loadHistory()
  else historyPage.value = 1
}

async function loadHistory() {
  if (!historyRow.value || !canReadHistory.value) return
  const active = historyGate.begin(() => historyVisible.value)
  if (!active()) return
  historyEntries.value = []
  historyError.value = ''
  historyLoading.value = true
  try {
    const result = await inventoryApi.skuHistory(historyRow.value.sku, { page: historyPage.value, pageSize: historyPageSize.value })
    if (!active()) return
    historyEntries.value = result.items || []
    historyTotal.value = result.total ?? 0
  } catch (error) {
    if (active()) historyError.value = userFacingError(error)
  } finally {
    if (active()) historyLoading.value = false
  }
}

function describeChanges(detail: { changes?: Record<string, unknown>; message?: string } | null) {
  const show = (value: unknown) => value == null || value === '' ? '—' : String(value)
  const changes = Object.entries(detail?.changes || {}).map(([field, value]) => {
    const name = historyFieldLabels[field] || field
    if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
      return `${name}：${show(value.from)} → ${show(value.to)}`
    }
    return `${name}：${show(value)}`
  })
  return changes.length ? changes : [detail?.message || '—']
}

function openEdit(row: any) {
  const id = row.erpProductId ?? (typeof row.id === 'number' ? row.id : null)
  if (!id) {
    ElMessage.warning('仅 ERP 主数据产品可在此编辑')
    return
  }
  editRow.value = { ...row, erpProductId: id }
  editForm.value = {
    productName: row.productName || '',
    spec: row.spec || '',
    barcode: row.barcode || '',
    brand: row.brand || '',
    category: row.category || '',
    spu: row.spu || '',
    weightKg: row.weightKg ?? '',
    costRmb: row.costRmb ?? '',
    lengthCm: row.lengthCm ?? '',
    widthCm: row.widthCm ?? '',
    heightCm: row.heightCm ?? '',
    measuredLengthCm: row.measuredLengthCm ?? '',
    measuredWidthCm: row.measuredWidthCm ?? '',
    measuredHeightCm: row.measuredHeightCm ?? '',
  }
  editVisible.value = true
}

async function saveEdit() {
  if (!editRow.value?.erpProductId || editSaving.value || !app.hasPerm('inventory_query.adjust')) return
  const identity = queryScope()
  if (!identity) return
  editSaving.value = true
  try {
    const f = editForm.value
    const measuredOnly = editRow.value.editMode === 'measured_only'
    const payload: Record<string, unknown> = measuredOnly
      ? {
          measuredLengthCm: f.measuredLengthCm,
          measuredWidthCm: f.measuredWidthCm,
          measuredHeightCm: f.measuredHeightCm,
        }
      : {
          productName: f.productName,
          spec: f.spec,
          barcode: f.barcode,
          brand: f.brand,
          category: f.category,
          spu: f.spu,
          weightKg: f.weightKg,
          costRmb: f.costRmb,
          lengthCm: f.lengthCm,
          widthCm: f.widthCm,
          heightCm: f.heightCm,
          measuredLengthCm: f.measuredLengthCm,
          measuredWidthCm: f.measuredWidthCm,
          measuredHeightCm: f.measuredHeightCm,
        }
    const updated = await inventoryApi.updateSkuCatalog(editRow.value.erpProductId, payload)
    if (identity !== queryScope()) return
    const idx = rows.value.findIndex((r) => r.erpProductId === updated.erpProductId && r.sku === updated.sku)
    if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...updated }
    ElMessage.success('保存成功')
    editVisible.value = false
  } catch (e: any) {
    if (identity === queryScope()) ElMessage.error(userFacingError(displaySkuText(e?.message || '保存失败')))
  } finally {
    editSaving.value = false
  }
}

function goInventory(row: any) {
  router.push({ path: '/inventory', query: { sku: row.sku } })
}

function goLocations() {
  router.push('/warehouse/locations')
}

function escapeCsv(val: unknown) {
  const s = String(val ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportRows(list: any[]) {
  if (!app.hasPerm('sku_query.export')) return
  if (!list.length) {
    ElMessage.warning('没有可导出的数据')
    return
  }
  const headers = ['SKU', 'SPU', '商品名', '规格', '条码', '品类', '品牌', '状态', '重量kg', '长宽高cm', '申报成本', '客户商品状态', '添加时间', '更新时间']
  const lines = list.map((r) => [
    r.sku, r.spu, r.productName, r.spec, r.barcode, r.category, r.brand,
    r.statusLabel, r.weightLabel, r.dimLabel, r.costRmb ?? '',
    r.dataSource === 'oms' ? r.operationStatusLabel : '',
    fmtDate(r.createdAt), fmtDate(r.updatedAt),
  ])
  const bom = '\uFEFF'
  const content = bom + [headers.join(','), ...lines.map((r) => r.map(escapeCsv).join(','))].join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `SKU查询_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${list.length} 条`)
}

function handleBatch(cmd: string) {
  if (cmd === 'export') {
    if (!app.hasPerm('sku_query.export')) return
    exportRows(selectedRows.value)
  }
  if (cmd === 'clear') tableRef.value?.clearSelection()
}

function handlePrint() {
  window.print()
}

watch(queryScope, () => {
  listGate.invalidate()
  sourceCounts.value = null
  listTotal.value = 0
  detailVisible.value = false
  detailRow.value = null
  historyVisible.value = false
  historyRow.value = null
  historyEntries.value = []
  historyGate.invalidate()
  editVisible.value = false
  editRow.value = null
  search()
}, { flush: 'sync' })
onScopeDispose(() => {
  listGate.invalidate()
  historyGate.invalidate()
})
watch([page, pageSize], () => load())
watch([historyPage, historyPageSize], () => { if (historyVisible.value) void loadHistory() })
watch(historyVisible, (visible) => {
  if (visible) return
  historyGate.invalidate()
  historyLoading.value = false
})
onMounted(() => {
  const q = String(route.query.q || route.query.sku || '').trim()
  if (q) filters.value.title = q
  const source = route.query.dataSource
  if (source === 'erp' || source === 'oms') filters.value.dataSource = source
  load()
})
</script>

<template>
  <div class="sku-query-page">
    <!-- 筛选区 -->
    <div class="filter-panel">
      <div class="filter-grid">
        <div class="filter-item">
          <label>供应商</label>
          <el-input v-model="filters.supplierKeyword" :disabled="filters.dataSource === 'oms'" placeholder="供应商代码/名称（仅货盘）" clearable size="small" />
        </div>
        <div class="filter-item">
          <label>产品标题</label>
          <el-input v-model="filters.title" placeholder="支持模糊查询" clearable size="small" />
        </div>
        <div class="filter-item">
          <label>SKU 编码</label>
          <el-input v-model="filters.skuCodes" placeholder="系统 SKU / 客户 SKU，空格分隔" clearable size="small" />
        </div>

        <div class="filter-item">
          <label>外箱条码</label>
          <el-input v-model="filters.barcode" placeholder="条码/EAN" clearable size="small" />
        </div>
        <div class="filter-item filter-item--range">
          <label>申报价值</label>
          <div class="range-inputs">
            <el-input v-model="filters.costMin" placeholder="最小" size="small" />
            <span class="range-sep">—</span>
            <el-input v-model="filters.costMax" placeholder="最大" size="small" />
          </div>
        </div>
        <div class="filter-item">
          <label>产品状态</label>
          <el-select v-model="filters.statusFilter" size="small" style="width:100%">
            <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </div>

        <div class="filter-item">
          <label>产品种类</label>
          <el-input v-model="filters.category" placeholder="品类" clearable size="small" />
        </div>
        <div class="filter-item">
          <label>品牌</label>
          <el-input v-model="filters.brand" placeholder="品牌" clearable size="small" />
        </div>
        <div class="filter-item filter-item--span2">
          <label>添加时间</label>
          <el-date-picker
            v-model="filters.createdRange"
            type="daterange"
            range-separator="—"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            size="small"
            style="width:100%"
          />
        </div>

        <div class="filter-item filter-item--span2">
          <label>最后更新时间</label>
          <el-date-picker
            v-model="filters.updatedRange"
            type="daterange"
            range-separator="—"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            size="small"
            style="width:100%"
          />
        </div>
      </div>
      <div class="filter-actions">
        <el-button type="primary" size="default" @click="search">查询</el-button>
        <el-button size="default" @click="resetFilters">重置</el-button>
      </div>
    </div>

    <!-- 工具栏 + 表格 -->
    <div class="table-panel">
      <div class="table-toolbar">
        <el-radio-group v-model="filters.dataSource" size="small" aria-label="来源" @change="search">
          <el-radio-button v-for="tab in sourceTabs" :key="tab.value" :value="tab.value">
            {{ tab.label }}<span v-if="sourceCounts" class="tab-count">({{ sourceCounts[tab.value] }})</span>
          </el-radio-button>
        </el-radio-group>
        <div class="toolbar-actions">
          <el-button size="small" @click="goLocations">维护库位</el-button>
          <el-button size="small" @click="handlePrint">打印</el-button>
          <el-dropdown trigger="click" @command="handleBatch">
            <el-button size="small">
              批量 <span class="el-dropdown-link">▾</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="app.hasPerm('sku_query.export')" command="export">导出选中</el-dropdown-item>
                <el-dropdown-item command="clear">取消选择</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click">
            <el-button size="small">
              导入/导出 <span class="el-dropdown-link">▾</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="app.hasPerm('sku_query.export')" @click="exportRows(rows)">导出当前页</el-dropdown-item>
                <el-dropdown-item v-if="app.hasPerm('sku_query.export')" @click="exportRows(selectedRows.length ? selectedRows : rows)">导出选中/当前页</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="rows"
        border
        size="small"
        class="sku-table"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="42" fixed="left" />
        <el-table-column label="NO." width="52" align="center" fixed="left">
          <template #default="{ $index }">{{ rowIndex($index) }}</template>
        </el-table-column>

        <el-table-column label="产品信息" min-width="220" fixed="left">
          <template #default="{ row }">
            <div class="prod-info">
              <div>
                <el-button link type="primary" class="prod-sku" @click="openDetail(row)">{{ displaySku(row) }}</el-button>
              </div>
              <div v-if="row.spu" class="prod-sub"><span class="lbl">自定义编码:</span> {{ row.spu }}</div>
              <div class="prod-name">{{ row.productName }}</div>
              <div v-if="row.spec" class="prod-sub prod-en">{{ row.spec }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="来源" width="96" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.dataSource === 'erp' ? 'primary' : 'warning'">
              {{ row.dataSource === 'oms' ? sourceLabels.oms : sourceLabels.erp }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="客户代码" width="96">
          <template #default="{ row }">
            <span class="mono">{{ row.customerCode || '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="产品状态" width="88" align="center">
          <template #default="{ row }">
            <span :class="['status-text', row.status === 'active' ? 'ok' : 'muted']">{{ row.statusLabel }}</span>
          </template>
        </el-table-column>

        <el-table-column label="收货标志" width="80" align="center">
          <template #default="{ row }">
            <span :class="row.receiptFlag === '新产品' ? 'flag-new' : 'flag-ok'">{{ row.receiptFlag }}</span>
          </template>
        </el-table-column>

        <el-table-column label="产品重(KG) 体积(CM)" width="150">
          <template #default="{ row }">
            <div class="dim-block">
              <div>{{ row.weightLabel || '—' }}</div>
              <div v-if="row.customerDimLabel" class="dim-line"><span class="lbl">客户:</span> {{ row.customerDimLabel }}</div>
              <div v-if="row.measuredDimLabel" class="dim-line"><span class="lbl">实测:</span> {{ row.measuredDimLabel }}</div>
              <div v-if="row.billingDimLabel && row.billingDimSource === 'measured'" class="dim-line dim-billing"><span class="lbl">仓租:</span> {{ row.billingDimLabel }}</div>
              <div v-else-if="!row.customerDimLabel && !row.measuredDimLabel" class="dim-line">—</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="category" label="分类" width="80">
          <template #default="{ row }">{{ row.category || '—' }}</template>
        </el-table-column>

        <el-table-column label="产品单位" width="72" align="center">
          <template #default>件</template>
        </el-table-column>

        <el-table-column label="客户商品状态" width="110" align="center">
          <template #default="{ row }">
            <span>{{ row.dataSource === 'oms' ? row.operationStatusLabel || '未知' : '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="仓库/库位" width="100">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goInventory(row)">查库存</el-button>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="128" fixed="right" align="center">
          <template #default="{ row }">
            <el-dropdown trigger="click" placement="bottom-end" popper-class="table-row-dropdown">
              <el-button size="small" class="more-btn" @click.stop>
                <span class="gear">⚙</span> 更多操作
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openDetail(row)">查看详情</el-dropdown-item>
                  <el-dropdown-item v-if="canReadHistory" @click="openHistory(row.sku, row.customerSku)">修改日志</el-dropdown-item>
                  <el-dropdown-item v-if="row.editable" @click="openEdit(row)">编辑信息</el-dropdown-item>
                  <el-dropdown-item @click="goInventory(row)">库存查询</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <el-alert v-if="loadError" type="error" :title="loadError" :closable="false" show-icon>
        <el-button @click="retryList">重试商品查询</el-button>
      </el-alert>
      <el-empty v-if="!loading && !loadError && !rows.length" description="暂无匹配 SKU" />
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />
    </div>

    <el-dialog v-model="detailVisible" :title="`产品详情 · ${displaySku(detailRow) || ''}`" width="560px" class="erp-detail">
      <template v-if="detailRow">
        <DetailSheet
          :kicker="displaySku(detailRow)"
          :title="detailRow.productName"
          :subtitle="[detailRow.spec, detailRow.category, detailRow.brand].filter(Boolean).join(' · ')"
        >
          <template #status>
            <el-tag size="small">{{ detailRow.statusLabel }}</el-tag>
          </template>
        </DetailSheet>
        <dl class="detail-dl">
          <dt>SPU</dt><dd>{{ detailRow.spu || '—' }}</dd>
          <dt>条码</dt><dd>{{ detailRow.barcode || '—' }}</dd>
          <dt>客户申报(cm)</dt><dd>{{ detailRow.customerDimLabel || '—' }}</dd>
          <dt>仓库实测(cm)</dt><dd>{{ detailRow.measuredDimLabel || '—' }}</dd>
          <dt>仓租计费(cm)</dt><dd>{{ detailRow.billingDimLabel || '—' }}<span v-if="detailRow.billingDimSource" class="lbl">（{{ detailRow.billingDimSource === 'measured' ? '优先实测' : detailRow.billingDimSource === 'customer' ? '客户申报' : '—' }}）</span></dd>
          <dt>重量(kg)</dt><dd>{{ detailRow.weightLabel || '—' }}</dd>
          <dt>申报成本</dt><dd>{{ detailRow.costRmb != null ? detailRow.costRmb : '—' }}</dd>
          <template v-if="detailRow.dataSource === 'oms'">
            <dt>客户商品状态</dt><dd>{{ detailRow.operationStatusLabel || '未知' }}</dd>
          </template>
          <dt>添加时间</dt><dd>{{ fmtTime(detailRow.createdAt) }}</dd>
          <dt>更新时间</dt><dd>{{ fmtTime(detailRow.updatedAt) }}</dd>
        </dl>
      </template>
    </el-dialog>

    <el-dialog v-model="historyVisible" :title="`SKU 修改日志 · ${displaySku(historyRow)}`" width="min(880px, 96vw)" destroy-on-close>
      <el-alert v-if="historyError" :title="historyError" type="error" :closable="false" show-icon>
        <el-button size="small" @click="loadHistory">重试</el-button>
      </el-alert>
      <el-table v-else v-loading="historyLoading" :data="historyEntries" row-key="id" empty-text="暂无 SKU 修改日志" border size="small" max-height="440">
        <el-table-column label="操作时间" width="166">
          <template #default="{ row }">{{ row.createdAt ? historyTime.format(new Date(row.createdAt)) : '—' }}</template>
        </el-table-column>
        <el-table-column label="操作者" min-width="112" show-overflow-tooltip>
          <template #default="{ row }">{{ row.operatorName === '—' && row.operatorId ? `#${row.operatorId}` : row.operatorName }}</template>
        </el-table-column>
        <el-table-column label="操作 IP" min-width="132" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.ipAddress || '未记录' }}</span></template>
        </el-table-column>
        <el-table-column prop="actionLabel" label="操作" min-width="128" show-overflow-tooltip />
        <el-table-column label="修改内容" min-width="218">
          <template #default="{ row }">
            <div v-for="(change, index) in describeChanges(row.detail)" :key="index">{{ change }}</div>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-if="!historyError" v-model:page="historyPage" v-model:page-size="historyPageSize" :total="historyTotal" />
    </el-dialog>

    <el-dialog
      v-model="editVisible"
      :title="`编辑 · ${displaySku(editRow) || ''}`"
      width="560px"
      destroy-on-close
    >
      <el-alert
        v-if="editRow?.editMode === 'measured_only'"
        type="warning"
        :closable="false"
        show-icon
        title="该 SKU 已有库存，仅可修改仓库实测长宽高（用于仓租计费）"
        style="margin-bottom: 12px"
      />
      <el-form v-if="editRow" label-width="108px" size="small">
        <template v-if="editRow.editMode !== 'measured_only'">
          <el-form-item label="商品名" required>
            <el-input v-model="editForm.productName" />
          </el-form-item>
          <el-form-item label="规格">
            <el-input v-model="editForm.spec" />
          </el-form-item>
          <el-form-item label="条码">
            <el-input v-model="editForm.barcode" />
          </el-form-item>
          <el-form-item label="品牌">
            <el-input v-model="editForm.brand" />
          </el-form-item>
          <el-form-item label="品类">
            <el-input v-model="editForm.category" />
          </el-form-item>
          <el-form-item label="SPU">
            <el-input v-model="editForm.spu" />
          </el-form-item>
          <el-form-item label="重量(kg)">
            <el-input v-model="editForm.weightKg" type="number" />
          </el-form-item>
          <el-form-item label="申报成本">
            <el-input v-model="editForm.costRmb" type="number" />
          </el-form-item>
          <el-divider content-position="left">客户申报尺寸 (cm)</el-divider>
          <el-form-item label="长">
            <el-input v-model="editForm.lengthCm" type="number" />
          </el-form-item>
          <el-form-item label="宽">
            <el-input v-model="editForm.widthCm" type="number" />
          </el-form-item>
          <el-form-item label="高">
            <el-input v-model="editForm.heightCm" type="number" />
          </el-form-item>
        </template>
        <el-divider content-position="left">仓库实测尺寸 (cm)</el-divider>
        <el-form-item label="实测长">
          <el-input v-model="editForm.measuredLengthCm" type="number" />
        </el-form-item>
        <el-form-item label="实测宽">
          <el-input v-model="editForm.measuredWidthCm" type="number" />
        </el-form-item>
        <el-form-item label="实测高">
          <el-input v-model="editForm.measuredHeightCm" type="number" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.sku-query-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-panel {
  background: #fff;
  border: 1px solid #dcdfe6;
  padding: 14px 16px 12px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 16px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-item label {
  font-size: 12px;
  color: #606266;
  line-height: 1.2;
}

.filter-item--span2 {
  grid-column: span 2;
}

.filter-item--range .range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.range-sep {
  color: #909399;
  flex-shrink: 0;
}

.filter-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed #e4e7ed;
}

.table-panel {
  background: #fff;
  border: 1px solid #dcdfe6;
  padding: 10px 12px 12px;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}

.tab-count { margin-left: 2px; font-size: 11px; opacity: 0.85; }

.toolbar-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sku-table {
  font-size: 12px;
}

.sku-table :deep(.el-table__cell) {
  vertical-align: top;
  padding: 8px 0;
}

.prod-info {
  line-height: 1.45;
  padding: 0 4px;
}

.prod-sku {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  font-weight: 600;
  padding: 0;
}

.prod-name {
  color: #303133;
  margin-top: 2px;
}

.prod-sub {
  font-size: 11px;
  color: #909399;
}

.prod-en {
  color: #606266;
}

.lbl {
  color: #909399;
}

.mono {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
}

.status-text.ok { color: #303133; }
.status-text.muted { color: #909399; }

.flag-new { color: #e6a23c; font-size: 12px; }
.flag-ok { color: #67c23a; font-size: 12px; }

.dim-block {
  line-height: 1.5;
  font-size: 12px;
}

.dim-line {
  color: #606266;
}

.dim-billing {
  color: #409eff;
  font-weight: 500;
}

.more-btn {
  padding: 4px 8px;
  font-size: 12px;
}

.gear {
  margin-right: 2px;
}

@media (max-width: 1100px) {
  .filter-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .filter-item--span2 {
    grid-column: span 1;
  }
}

@media print {
  .filter-panel,
  .table-toolbar,
  .list-pagination,
  .el-table-column--selection,
  .el-table__fixed-right {
    display: none !important;
  }
}
</style>
