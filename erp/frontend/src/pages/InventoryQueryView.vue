<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { inventoryApi, warehouseApi, locationApi, productApi } from '@/api/client.js'
import { mapWarehouse } from '@/api/mappers.ts'
import { withAction } from '@/composables/useListLoader.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import ImportFieldLegend from '@/components/ImportFieldLegend.vue'
import {
  downloadInventoryAdjustTemplate,
  INVENTORY_ADJUST_IMPORT_FIELDS,
  parseInventoryAdjustCsvClient,
  type InventoryAdjustImportRow,
} from '@/constants/importTemplates.ts'
import { normalizeImportFileText } from '@/utils/csv'

const app = useAppStore()
const router = useRouter()
const route = useRoute()
const canAdjust = computed(() => app.hasPerm('inventory_query.adjust'))

const JHB_WAREHOUSE_CODE = 'WMS-JHB-01'
const tableRef = ref<TableInstance>()
const loading = ref(false)
const rows = ref<any[]>([])
const listTotal = ref(0)
const page = ref(1)
const pageSize = ref(20)
const allWarehouses = ref<any[]>([])

const filters = ref({
  customerCode: '',
  skuCodes: '',
  warehouses: [] as string[],
  productCode: '',
  exactSku: false,
  barcode: '',
  qtyType: 'available',
  qtyMin: '',
  qtyMax: '',
  category: '',
  lowStockOnly: 'all',
})

const sourceFilter = ref<'all' | 'erp' | 'oms'>('all')
const sourceCounts = ref({ all: 0, erp: 0, oms: 0 })

const sourceTabs = computed(() => [
  { value: 'all' as const, label: '全部', count: sourceCounts.value.all },
  { value: 'erp' as const, label: 'ERP 海外仓', count: sourceCounts.value.erp },
  { value: 'oms' as const, label: 'OMS 客户', count: sourceCounts.value.oms },
])

// dialogs
const locDialogVisible = ref(false)
const locDialogSku = ref('')
const locDialogWarehouse = ref('')
const locDialogCustomerCode = ref('')
const skuLocations = ref<any[]>([])
const outboundLogVisible = ref(false)
const outboundLogLoading = ref(false)
const outboundLogSku = ref('')
const outboundLogWarehouse = ref('')
const outboundLogRows = ref<any[]>([])
const adjustDialogVisible = ref(false)
const adjustForm = ref({
  id: 0, sku: '', productName: '', warehouseCode: '', locationCode: '', qty: 0,
  newLocationCode: '', customerCode: '', remark: '',
})
const changeDialogVisible = ref(false)
const changeTab = ref<'single' | 'batch'>('single')
const changeForm = ref({
  customerCode: '',
  sku: '',
  productName: '',
  warehouseCode: JHB_WAREHOUSE_CODE,
  fromLocationCode: '',
  toLocationCode: '',
  qty: 0,
  remark: '',
})
const batchPreviewRows = ref<InventoryAdjustImportRow[]>([])
const batchSubmitting = ref(false)
const changeFileInputRef = ref<HTMLInputElement | null>(null)
const locationOptions = ref<any[]>([])
const locationOptionsLoading = ref(false)
const skuOptions = ref<any[]>([])
const skuSearchLoading = ref(false)

const qtyTypeOptions = [
  { value: 'available', label: '可用' },
  { value: 'total', label: '总量' },
  { value: 'locked', label: '锁定' },
]

const lowStockOptions = [
  { value: 'all', label: '全部' },
  { value: 'yes', label: '是' },
  { value: 'no', label: '否' },
]

function isJhbWarehouse(wh: { code?: string; name?: string }) {
  const code = String(wh.code || '').toUpperCase()
  const name = String(wh.name || '').toUpperCase()
  return code === JHB_WAREHOUSE_CODE || code.includes('JHB') || name.includes('JHB')
}

function buildParams() {
  const p: Record<string, unknown> = { page: page.value, pageSize: pageSize.value }
  const customerKw = filters.value.customerCode.trim()
  if (customerKw) {
    p.customerKeyword = customerKw
    p.supplierKeyword = customerKw
  }
  if (filters.value.skuCodes.trim()) p.skuCodes = filters.value.skuCodes.trim()
  if (filters.value.productCode.trim()) {
    p.productCode = filters.value.productCode.trim()
    if (filters.value.exactSku) p.exactSku = '1'
  }
  if (filters.value.barcode.trim()) p.barcode = filters.value.barcode.trim()
  if (filters.value.category.trim()) p.category = filters.value.category.trim()
  if (filters.value.qtyType) p.qtyType = filters.value.qtyType
  if (filters.value.qtyMin !== '') p.qtyMin = filters.value.qtyMin
  if (filters.value.qtyMax !== '') p.qtyMax = filters.value.qtyMax
  if (filters.value.lowStockOnly === 'yes') p.lowStockOnly = 'yes'
  if (sourceFilter.value !== 'all') p.dataSource = sourceFilter.value
  if (filters.value.warehouses.length) {
    p.warehouseCodes = filters.value.warehouses.join(',')
  } else {
    p.warehouseCode = JHB_WAREHOUSE_CODE
  }
  return p
}

async function load() {
  loading.value = true
  try {
    const res = await inventoryApi.query(buildParams())
    rows.value = res.items || []
    listTotal.value = res.total ?? 0
    if (res.sourceCounts) sourceCounts.value = res.sourceCounts
  } catch (e: any) {
    rows.value = []
    listTotal.value = 0
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function resetFilters() {
  filters.value = {
    customerCode: '',
    skuCodes: '',
    warehouses: allWarehouses.value.length ? [allWarehouses.value[0].code] : [JHB_WAREHOUSE_CODE],
    productCode: '',
    exactSku: false,
    barcode: '',
    qtyType: 'available',
    qtyMin: '',
    qtyMax: '',
    category: '',
    lowStockOnly: 'all',
  }
  sourceFilter.value = 'all'
  page.value = 1
  load()
}

function onSourceChange() {
  page.value = 1
  load()
}

function rowIndex(index: number) {
  return (page.value - 1) * pageSize.value + index + 1
}

function escapeCsv(val: unknown) {
  const s = String(val ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportRows(list = rows.value) {
  if (!list.length) {
    ElMessage.warning('没有可导出的数据')
    return
  }
  const headers = ['SKU', '商品名', '来源', '品类', '客户代码', '客户名称', '可用', '锁定', '可售', '待出库', '在途', '待上架']
  const lines = list.map((r) => [
    r.sku, r.productName, r.dataSourceLabel || r.dataSource, r.category, r.customerCode,
    r.customerName || r.supplierName, r.availableQty, r.lockedQty ?? 0,
    r.sellableQty, r.pendingOutboundQty, r.inTransitQty, r.pendingPutawayQty,
  ])
  const bom = '\uFEFF'
  const content = bom + [headers.join(','), ...lines.map((l) => l.map(escapeCsv).join(','))].join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `库存查询_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${list.length} 条`)
}

async function showSkuLocations(row: any) {
  if (row.dataSource !== 'erp') {
    ElMessage.info('库位明细仅适用于 ERP 海外仓实收库存')
    return
  }
  locDialogSku.value = row.sku
  locDialogWarehouse.value = row.warehouseCode || JHB_WAREHOUSE_CODE
  locDialogCustomerCode.value = row.customerCode || filters.value.customerCode.trim()
  try {
    skuLocations.value = await inventoryApi.byLocation({
      sku: row.sku,
      warehouseCode: row.warehouseCode,
    })
  } catch {
    skuLocations.value = []
  }
  locDialogVisible.value = true
}

async function openOutboundLogs(row: any) {
  outboundLogSku.value = row.sku
  outboundLogWarehouse.value = row.warehouseCode
  outboundLogVisible.value = true
  outboundLogLoading.value = true
  outboundLogRows.value = []
  try {
    outboundLogRows.value = await inventoryApi.outboundLogs(row.sku, { warehouseCode: row.warehouseCode })
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    outboundLogLoading.value = false
  }
}

async function loadLocationOptions(warehouseCode: string) {
  locationOptionsLoading.value = true
  try {
    const res = await locationApi.list({ warehouseCode, status: 'available' })
    locationOptions.value = Array.isArray(res) ? res : res.items || []
  } catch {
    locationOptions.value = []
  } finally {
    locationOptionsLoading.value = false
  }
}

function openAdjust(row: any, customerCode?: string) {
  adjustForm.value = {
    id: row.id,
    sku: row.sku,
    productName: row.productName || '',
    warehouseCode: row.warehouseCode,
    locationCode: row.locationCode,
    qty: row.qty,
    newLocationCode: row.locationCode,
    customerCode: customerCode || locDialogCustomerCode.value || filters.value.customerCode.trim(),
    remark: '',
  }
  adjustDialogVisible.value = true
  loadLocationOptions(row.warehouseCode)
}

async function openAdjustFromRow(row: any) {
  try {
    const locs = await inventoryApi.byLocation({ sku: row.sku, warehouseCode: row.warehouseCode })
    if (!locs.length) {
      openStockChange({
        sku: row.sku,
        productName: row.productName,
        warehouseCode: row.warehouseCode,
        customerCode: row.customerCode,
      })
      return
    }
    if (locs.length === 1) {
      openAdjust(locs[0], row.customerCode)
      return
    }
    await showSkuLocations(row)
  } catch (e: any) {
    ElMessage.error(e?.message || '加载库位失败')
  }
}

async function submitAdjust() {
  if (!adjustForm.value.customerCode.trim()) return ElMessage.warning('请填写客户代码')
  if (adjustForm.value.qty < 0) return ElMessage.warning('数量不能为负')
  if (!adjustForm.value.newLocationCode) return ElMessage.warning('请选择目标库位')
  const ok = await withAction(async () => {
    await inventoryApi.adjustLocation(adjustForm.value.id, {
      qty: adjustForm.value.qty,
      locationCode: adjustForm.value.newLocationCode,
      customerCode: adjustForm.value.customerCode.trim(),
      remark: adjustForm.value.remark || undefined,
    })
    if (locDialogVisible.value) {
      skuLocations.value = await inventoryApi.byLocation({
        sku: adjustForm.value.sku,
        warehouseCode: adjustForm.value.warehouseCode,
      })
    }
    load()
  }, '库位库存已更新')
  if (ok) adjustDialogVisible.value = false
}

function openStockChange(preset?: {
  sku?: string
  productName?: string
  warehouseCode?: string
  customerCode?: string
  fromLocationCode?: string
  toLocationCode?: string
  qty?: number
}) {
  changeTab.value = 'single'
  batchPreviewRows.value = []
  changeForm.value = {
    customerCode: preset?.customerCode || filters.value.customerCode.trim(),
    sku: preset?.sku || '',
    productName: preset?.productName || '',
    warehouseCode: preset?.warehouseCode || filters.value.warehouses[0] || JHB_WAREHOUSE_CODE,
    fromLocationCode: preset?.fromLocationCode || '',
    toLocationCode: preset?.toLocationCode || '',
    qty: preset?.qty ?? 0,
    remark: '',
  }
  changeDialogVisible.value = true
  loadLocationOptions(changeForm.value.warehouseCode)
  skuOptions.value = preset?.sku ? [{ sku: preset.sku, productName: preset.productName || preset.sku }] : []
}

function triggerBatchImport() {
  changeFileInputRef.value?.click()
}

async function handleBatchImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = normalizeImportFileText(await file.text())
    batchPreviewRows.value = parseInventoryAdjustCsvClient(text, changeForm.value.warehouseCode || JHB_WAREHOUSE_CODE)
    changeTab.value = 'batch'
    ElMessage.success(`已解析 ${batchPreviewRows.value.length} 行，请确认后提交`)
  } catch (err: any) {
    batchPreviewRows.value = []
    ElMessage.error(err?.message || '解析失败')
  }
}

async function submitSingleChange() {
  const f = changeForm.value
  if (!f.customerCode.trim()) return ElMessage.warning('请填写客户代码')
  if (!f.sku.trim()) return ElMessage.warning('请选择 SKU')
  if (!f.toLocationCode) return ElMessage.warning('请选择目标库位')
  if (f.qty < 0) return ElMessage.warning('数量不能为负')
  if (f.qty === 0 && !f.fromLocationCode) return ElMessage.warning('新库位库存数量须大于 0')
  const ok = await withAction(async () => {
    await inventoryApi.changeLocationStock({
      customerCode: f.customerCode.trim(),
      sku: f.sku.trim(),
      warehouseCode: f.warehouseCode,
      fromLocationCode: f.fromLocationCode.trim() || undefined,
      toLocationCode: f.toLocationCode,
      qty: f.qty,
      remark: f.remark || undefined,
    })
    load()
  }, '库存变更已保存')
  if (ok) changeDialogVisible.value = false
}

async function submitBatchChange() {
  if (!batchPreviewRows.value.length) return ElMessage.warning('请先上传 XLS 或 CSV 模板')
  batchSubmitting.value = true
  try {
    const res = await inventoryApi.batchChangeLocationStock({
      rows: batchPreviewRows.value,
      defaultWarehouse: changeForm.value.warehouseCode || JHB_WAREHOUSE_CODE,
    })
    const failed = (res.results || []).filter((r: any) => !r.ok)
    if (res.fail > 0) {
      ElMessage.warning(`成功 ${res.ok} 行，失败 ${res.fail} 行${failed[0]?.error ? `：${failed[0].error}` : ''}`)
    } else {
      ElMessage.success(`批量变更完成，共 ${res.ok} 行`)
      changeDialogVisible.value = false
      batchPreviewRows.value = []
      load()
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '批量变更失败')
  } finally {
    batchSubmitting.value = false
  }
}

async function searchSkuOptions(keyword: string) {
  const q = keyword.trim()
  if (!q) { skuOptions.value = []; return }
  skuSearchLoading.value = true
  try {
    const res = await productApi.list({ keyword: q, pageSize: 20 })
    skuOptions.value = (res.items || res || []).map((p: any) => ({ sku: p.sku, productName: p.productName || p.name || '' }))
  } catch {
    skuOptions.value = []
  } finally {
    skuSearchLoading.value = false
  }
}

function goSkuQuery(row: any) {
  router.push({ path: '/inventory/sku-query', query: { q: row.sku } })
}

onMounted(async () => {
  try {
    const res = await warehouseApi.list({ type: 'wms' })
    const mapped = (Array.isArray(res) ? res : res.items || []).map(mapWarehouse).filter(isJhbWarehouse)
    allWarehouses.value = mapped.length ? mapped : [{ code: JHB_WAREHOUSE_CODE, name: 'JHB' }]
  } catch {
    allWarehouses.value = [{ code: JHB_WAREHOUSE_CODE, name: 'JHB' }]
  }
  filters.value.warehouses = [allWarehouses.value[0].code]
  const qSku = String(route.query.sku || '').trim()
  if (qSku) filters.value.productCode = qSku
  load()
})

watch([page, pageSize], () => load())
</script>

<template>
  <div class="inv-query-page">
    <el-card shadow="never" class="page-card">
      <template #header>
        <div class="page-header">
          <div>
            <span class="page-title">库存查询</span>
            <p class="page-desc">JHB 实收与 OMS 客户库存；售价请在「货盘库存」维护，货盘持有请至同页「货盘持有」查看。</p>
          </div>
        </div>
      </template>

      <div class="filter-grid">
        <div class="filter-item">
          <label>客户 / 供应商</label>
          <el-input v-model="filters.customerCode" placeholder="OMS 客户代码或 ERP 供应商" clearable size="small" @keyup.enter="search" />
        </div>
        <div class="filter-item">
          <label>产品代码</label>
          <div class="inline-with-check">
            <el-input v-model="filters.productCode" placeholder="SKU / 品名" clearable size="small" @keyup.enter="search" />
            <el-checkbox v-model="filters.exactSku" size="small">精确</el-checkbox>
          </div>
        </div>
        <div class="filter-item">
          <label>SKU 列表</label>
          <el-input v-model="filters.skuCodes" placeholder="多个 SKU，空格分隔" clearable size="small" />
        </div>

        <div class="filter-item">
          <label>EAN 条码</label>
          <el-input v-model="filters.barcode" placeholder="条码" clearable size="small" />
        </div>
        <div class="filter-item filter-item--range">
          <label>数量区间</label>
          <div class="range-inputs">
            <el-select v-model="filters.qtyType" size="small" style="width:76px">
              <el-option v-for="o in qtyTypeOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-input v-model="filters.qtyMin" placeholder="最小" size="small" />
            <span class="range-sep">—</span>
            <el-input v-model="filters.qtyMax" placeholder="最大" size="small" />
          </div>
        </div>

        <div class="filter-item">
          <label>品类</label>
          <el-input v-model="filters.category" placeholder="品类关键词" clearable size="small" />
        </div>
        <div class="filter-item">
          <label>有库存</label>
          <el-radio-group v-model="filters.lowStockOnly" size="small">
            <el-radio-button v-for="o in lowStockOptions" :key="o.value" :value="o.value">{{ o.label }}</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div class="filter-actions">
        <el-button type="primary" size="small" @click="search">查询</el-button>
        <el-button size="small" @click="resetFilters">重置</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="page-card table-panel">
      <div class="source-bar">
        <el-radio-group v-model="sourceFilter" size="small" @change="onSourceChange">
          <el-radio-button v-for="tab in sourceTabs" :key="tab.value" :value="tab.value">
            {{ tab.label }}<span class="tab-count">({{ tab.count }})</span>
          </el-radio-button>
        </el-radio-group>
        <div class="toolbar-actions">
          <el-button v-if="canAdjust" size="small" @click="openStockChange()">库存变更</el-button>
          <el-button size="small" @click="exportRows()">导出</el-button>
        </div>
      </div>

      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="rows"
        border
        stripe
        size="small"
        class="inv-table"
        empty-text="暂无匹配库存"
        header-cell-class-name="inv-table-header"
        table-layout="auto"
      >
        <el-table-column label="#" width="44" align="center" fixed="left">
          <template #default="{ $index }">{{ rowIndex($index) }}</template>
        </el-table-column>

        <el-table-column label="系统 SKU" min-width="128" fixed="left" class-name="sku-col" show-overflow-tooltip>
          <template #default="{ row }">
            <button
              type="button"
              class="sku-link"
              :class="`sku-link--${row.dataSource || 'erp'}`"
              @click="row.dataSource === 'erp' ? showSkuLocations(row) : goSkuQuery(row)"
            >
              {{ row.sku }}
            </button>
          </template>
        </el-table-column>

        <el-table-column label="客户 SKU" min-width="100" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono">{{ row.customerSku || '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="品名 / 规格" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="title-cn">{{ row.productName || '—' }}</div>
            <div v-if="row.spec" class="title-en">{{ row.spec }}</div>
          </template>
        </el-table-column>

        <el-table-column label="来源" min-width="112" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag size="small" :type="row.dataSource === 'erp' ? 'primary' : 'warning'" class="source-tag">
              {{ row.dataSourceLabel || row.dataSource || '—' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="客户" min-width="136" show-overflow-tooltip>
          <template #default="{ row }">
            <div v-if="row.customerCode" class="mono">{{ row.customerCode }}</div>
            <div v-if="row.customerName || row.supplierName" class="cust-name">{{ row.customerName || row.supplierName }}</div>
            <span v-if="!row.customerCode && !row.customerName && !row.supplierName">—</span>
          </template>
        </el-table-column>

        <el-table-column label="库存数量" align="center">
          <el-table-column label="可用" min-width="64" align="right">
            <template #default="{ row }"><strong class="qty-num">{{ row.availableQty ?? 0 }}</strong></template>
          </el-table-column>
          <el-table-column label="锁定" min-width="64" align="right">
            <template #default="{ row }"><span class="qty-num">{{ row.lockedQty ?? row.pendingOutboundQty ?? 0 }}</span></template>
          </el-table-column>
          <el-table-column label="在途" min-width="60" align="right">
            <template #default="{ row }">
              <button v-if="row.inTransitQty > 0 && row.dataSource === 'erp'" type="button" class="link-num" @click="router.push('/inbound/receipt')">
                {{ row.inTransitQty }}
              </button>
              <span v-else class="qty-num">{{ row.inTransitQty ?? 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="待上架" min-width="68" align="right">
            <template #default="{ row }"><span class="qty-num">{{ row.pendingPutawayQty ?? 0 }}</span></template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="操作" width="76" fixed="right" align="center">
          <template #default="{ row }">
            <el-dropdown trigger="click">
              <el-button link type="primary" size="small">操作</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="row.dataSource === 'erp'" @click="showSkuLocations(row)">库位明细</el-dropdown-item>
                  <el-dropdown-item v-if="row.dataSource === 'erp'" @click="openOutboundLogs(row)">出库记录</el-dropdown-item>
                  <el-dropdown-item v-if="canAdjust && row.dataSource === 'erp'" @click="openAdjustFromRow(row)">调整库存</el-dropdown-item>
                  <el-dropdown-item @click="goSkuQuery(row)">SKU 主数据</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />
    </el-card>

    <!-- 库位分布 -->
    <el-dialog v-model="locDialogVisible" :title="`库位分布 · ${locDialogSku}`" width="520px">
      <el-table :data="skuLocations" border size="small">
        <el-table-column prop="locationCode" label="库位" width="130">
          <template #default="{ row }"><span class="mono">{{ row.locationCode }}</span></template>
        </el-table-column>
        <el-table-column prop="qty" label="数量" width="80" align="right" />
        <el-table-column prop="inboundNo" label="入库单" min-width="120">
          <template #default="{ row }"><span class="mono">{{ row.inboundNo || '—' }}</span></template>
        </el-table-column>
        <el-table-column v-if="canAdjust" label="操作" width="72">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openAdjust(row)">调整</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!skuLocations.length" description="暂无库位明细" :image-size="64" />
    </el-dialog>

    <!-- 出库记录 -->
    <el-dialog v-model="outboundLogVisible" :title="`出库记录 · ${outboundLogSku}`" width="760px" destroy-on-close>
      <el-table v-loading="outboundLogLoading" :data="outboundLogRows" border size="small" max-height="400">
        <el-table-column prop="outboundNo" label="出库单" width="130" />
        <el-table-column prop="qty" label="数量" width="80" align="right" />
        <el-table-column prop="customerName" label="客户" min-width="100" />
        <el-table-column prop="locationCode" label="库位" width="110" />
      </el-table>
    </el-dialog>

    <!-- 调整库位库存 -->
    <el-dialog v-model="adjustDialogVisible" title="调整库位库存" width="480px">
      <el-form label-width="90px" size="small">
        <el-form-item label="客户代码" required>
          <el-input v-model="adjustForm.customerCode" placeholder="如 TKL0001" />
        </el-form-item>
        <el-form-item label="SKU"><span class="mono">{{ adjustForm.sku }}</span></el-form-item>
        <el-form-item label="当前库位"><span class="mono">{{ adjustForm.locationCode }}</span></el-form-item>
        <el-form-item label="目标库位" required>
          <el-select v-model="adjustForm.newLocationCode" filterable style="width:100%" :loading="locationOptionsLoading">
            <el-option v-for="loc in locationOptions" :key="loc.id" :label="loc.locationCode" :value="loc.locationCode" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量" required>
          <el-input-number v-model="adjustForm.qty" :min="0" :max="999999" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="adjustForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAdjust">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="changeDialogVisible" title="库存变更" width="720px" destroy-on-close>
      <el-tabs v-model="changeTab">
        <el-tab-pane label="单条变更" name="single">
          <el-form label-width="90px" size="small" class="change-form">
            <el-form-item label="客户代码" required>
              <el-input v-model="changeForm.customerCode" placeholder="如 TKL、TKL0001" />
            </el-form-item>
            <el-form-item label="SKU" required>
              <el-select
                v-model="changeForm.sku"
                filterable
                remote
                :remote-method="searchSkuOptions"
                :loading="skuSearchLoading"
                style="width:100%"
              >
                <el-option v-for="opt in skuOptions" :key="opt.sku" :label="opt.sku" :value="opt.sku" />
              </el-select>
            </el-form-item>
            <el-form-item label="仓库">
              <el-select v-model="changeForm.warehouseCode" style="width:100%" @change="loadLocationOptions(changeForm.warehouseCode)">
                <el-option v-for="wh in allWarehouses" :key="wh.code" :label="wh.name || wh.code" :value="wh.code" />
              </el-select>
            </el-form-item>
            <el-form-item label="原库位">
              <el-select v-model="changeForm.fromLocationCode" filterable clearable style="width:100%" :loading="locationOptionsLoading" placeholder="移库时填写">
                <el-option v-for="loc in locationOptions" :key="loc.id" :label="loc.locationCode" :value="loc.locationCode" />
              </el-select>
            </el-form-item>
            <el-form-item label="目标库位" required>
              <el-select v-model="changeForm.toLocationCode" filterable style="width:100%" :loading="locationOptionsLoading">
                <el-option v-for="loc in locationOptions" :key="loc.id" :label="loc.locationCode" :value="loc.locationCode" />
              </el-select>
            </el-form-item>
            <el-form-item label="数量" required>
              <el-input-number v-model="changeForm.qty" :min="0" :max="999999" />
              <span class="field-hint">目标库位绝对库存</span>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="changeForm.remark" type="textarea" :rows="2" />
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="批量导入" name="batch">
          <div class="batch-toolbar">
            <el-button size="small" link type="primary" @click="downloadInventoryAdjustTemplate">下载模板</el-button>
            <el-button size="small" @click="triggerBatchImport">上传模板</el-button>
            <span v-if="batchPreviewRows.length" class="batch-count">已解析 {{ batchPreviewRows.length }} 行</span>
          </div>
          <ImportFieldLegend title="批量导入字段" :fields="INVENTORY_ADJUST_IMPORT_FIELDS" compact />
          <el-table v-if="batchPreviewRows.length" :data="batchPreviewRows" border size="small" max-height="280" class="batch-preview">
            <el-table-column prop="customerCode" label="客户代码" width="96" />
            <el-table-column prop="sku" label="SKU" min-width="110" />
            <el-table-column prop="warehouseCode" label="仓库" width="110" />
            <el-table-column prop="fromLocationCode" label="原库位" width="90" />
            <el-table-column prop="toLocationCode" label="目标库位" width="96" />
            <el-table-column prop="qty" label="数量" width="72" align="right" />
            <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
          </el-table>
          <el-empty v-else description="请下载模板并上传 XLS 或 CSV" :image-size="64" />
          <input ref="changeFileInputRef" type="file" accept=".csv,.xls,.txt" style="display:none" @change="handleBatchImportFile" />
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="changeDialogVisible = false">取消</el-button>
        <el-button
          v-if="changeTab === 'single'"
          type="primary"
          @click="submitSingleChange"
        >
          保存
        </el-button>
        <el-button
          v-else
          type="primary"
          :loading="batchSubmitting"
          :disabled="!batchPreviewRows.length"
          @click="submitBatchChange"
        >
          提交批量变更
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.inv-query-page { display: flex; flex-direction: column; gap: 12px; }

.page-card :deep(.el-card__header) { padding: 12px 16px; }
.page-card :deep(.el-card__body) { padding: 14px 16px 16px; }

.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.page-title { font-weight: 600; font-size: 15px; }
.page-desc { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }

.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 16px;
}

.filter-item { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.filter-item label { font-size: 12px; color: var(--el-text-color-secondary); }
.filter-item--range .range-inputs { display: flex; align-items: center; gap: 6px; }
.filter-item--range .range-inputs .el-input { flex: 1; min-width: 0; }
.range-sep { color: #909399; flex-shrink: 0; }

.inline-with-check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.inline-with-check .el-input { flex: 1; min-width: 0; }

.filter-actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.change-form { margin-top: 8px; }
.field-hint { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.batch-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.batch-count { font-size: 12px; color: var(--el-text-color-secondary); }
.batch-preview { margin-top: 8px; }
.reclaim-tip {
  margin: 0 0 12px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.source-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.tab-count { margin-left: 2px; font-size: 11px; opacity: 0.85; }
.toolbar-actions { display: flex; gap: 6px; flex-shrink: 0; }

.table-panel :deep(.el-card__body) {
  padding: 14px 12px 16px;
  overflow-x: auto;
}

.inv-table { font-size: 12px; width: 100%; min-width: 960px; }
.inv-table :deep(.inv-table-header) {
  background: var(--el-fill-color-light) !important;
  color: var(--el-text-color-primary);
  font-weight: 600;
  white-space: nowrap;
}

.inv-table :deep(.el-table__cell .cell) {
  line-height: 1.45;
  padding-top: 6px;
  padding-bottom: 6px;
}

.inv-table :deep(.sku-col .cell) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-tag {
  max-width: 100%;
  height: auto;
  white-space: normal;
  line-height: 1.35;
  padding: 2px 6px;
}

.qty-num {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, Consolas, monospace);
}

.sku-link {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.45;
  max-width: 100%;
  display: inline-block;
  vertical-align: top;
}
.sku-link--erp { color: var(--el-color-primary); font-weight: 600; }
.sku-link--oms { color: #e6a23c; font-weight: 600; }
.sku-link--catalog { color: var(--el-color-success); font-weight: 600; }
.sku-link:hover { text-decoration: underline; }

.title-cn { color: var(--el-text-color-primary); line-height: 1.4; }
.title-en { font-size: 11px; color: var(--el-text-color-secondary); margin-top: 2px; }

.mono { font-family: var(--font-mono, Consolas, monospace); font-size: 12px; }
.cust-name { font-size: 11px; color: var(--el-text-color-secondary); margin-top: 2px; }

.link-num {
  background: none;
  border: none;
  color: var(--el-color-primary);
  cursor: pointer;
  font-weight: 600;
  padding: 0;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
