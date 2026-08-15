<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { inventoryApi } from '@/api/client.js'
import { fmtTime, fmtDate } from '@/api/mappers.ts'
import ListPagination from '@/components/ListPagination.vue'

const router = useRouter()
const route = useRoute()
const tableRef = ref<TableInstance>()
const loading = ref(false)
const rows = ref<any[]>([])
const listTotal = ref(0)
const page = ref(1)
const pageSize = ref(20)
const selectedRows = ref<any[]>([])
const detailVisible = ref(false)
const detailRow = ref<any>(null)
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
  }
  if (filters.value.supplierKeyword.trim()) p.supplierKeyword = filters.value.supplierKeyword.trim()
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

async function load() {
  loading.value = true
  try {
    const res = await inventoryApi.skuQuery(buildParams())
    rows.value = res.items || []
    listTotal.value = res.total ?? 0
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
  page.value = 1
  load()
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
  if (!editRow.value?.erpProductId) return
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
    const idx = rows.value.findIndex((r) => r.sku === updated.sku)
    if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...updated }
    ElMessage.success('保存成功')
    editVisible.value = false
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
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
  if (!list.length) {
    ElMessage.warning('没有可导出的数据')
    return
  }
  const headers = ['SKU', 'SPU', '商品名', '规格', '条码', '品类', '品牌', '状态', '重量kg', '长宽高cm', '申报成本', '销售状态', '添加时间', '更新时间']
  const lines = list.map((r) => [
    r.sku, r.spu, r.productName, r.spec, r.barcode, r.category, r.brand,
    r.statusLabel, r.weightLabel, r.dimLabel, r.costRmb ?? '', r.salesStatus,
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
  if (cmd === 'export') exportRows(selectedRows.value)
  if (cmd === 'clear') tableRef.value?.clearSelection()
}

function handlePrint() {
  window.print()
}

watch([page, pageSize], () => load())
onMounted(() => {
  const q = String(route.query.q || route.query.sku || '').trim()
  if (q) filters.value.title = q
  load()
})
</script>

<template>
  <div class="sku-query-page">
    <!-- 筛选区 -->
    <div class="filter-panel">
      <div class="filter-grid">
        <div class="filter-item">
          <label>厂商代码</label>
          <el-input v-model="filters.supplierKeyword" placeholder="供应商代码/名称" clearable size="small" />
        </div>
        <div class="filter-item">
          <label>产品标题</label>
          <el-input v-model="filters.title" placeholder="支持模糊查询" clearable size="small" />
        </div>
        <div class="filter-item">
          <label>自定义编码</label>
          <el-input v-model="filters.skuCodes" placeholder="SKU，中间以空格隔开" clearable size="small" />
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
        <span class="toolbar-hint">ERP 海外仓 + OMS 客户库存</span>
        <div class="toolbar-actions">
          <el-button size="small" @click="goLocations">维护库位</el-button>
          <el-button size="small" @click="handlePrint">打印</el-button>
          <el-dropdown trigger="click" @command="handleBatch">
            <el-button size="small">
              批量 <span class="el-dropdown-link">▾</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="export">导出选中</el-dropdown-item>
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
                <el-dropdown-item @click="exportRows(rows)">导出当前页</el-dropdown-item>
                <el-dropdown-item @click="exportRows(selectedRows.length ? selectedRows : rows)">导出选中/当前页</el-dropdown-item>
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
                <el-button link type="primary" class="prod-sku" @click="openDetail(row)">{{ row.sku }}</el-button>
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
              {{ row.dataSourceLabel || row.dataSource || '—' }}
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

        <el-table-column label="产品仓库属性" min-width="160">
          <template #default="{ row }">
            <div class="attr-list">
              <div v-if="row.barcode"><span class="lbl">条码:</span> {{ row.barcode }}</div>
              <div v-if="row.brand"><span class="lbl">品牌:</span> {{ row.brand }}</div>
              <div v-if="row.supplierName"><span class="lbl">供应商:</span> {{ row.supplierName }}</div>
              <div><span class="lbl">同步:</span> {{ row.syncStatus === 'synced' ? '已同步' : '待同步' }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="category" label="分类" width="80">
          <template #default="{ row }">{{ row.category || '—' }}</template>
        </el-table-column>

        <el-table-column label="产品单位" width="72" align="center">
          <template #default>件</template>
        </el-table-column>

        <el-table-column label="销售状态" width="88" align="center">
          <template #default="{ row }">
            <span :class="row.orderableOnOms ? 'sales-ok' : 'sales-muted'">{{ row.salesStatus }}</span>
          </template>
        </el-table-column>

        <el-table-column label="仓库/库位" width="100">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goInventory(row)">查库存</el-button>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="100" fixed="right" align="center">
          <template #default="{ row }">
            <el-dropdown trigger="click">
              <el-button size="small" class="more-btn">
                <span class="gear">⚙</span> 更多操作
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openDetail(row)">查看详情</el-dropdown-item>
                  <el-dropdown-item v-if="row.editable" @click="openEdit(row)">编辑信息</el-dropdown-item>
                  <el-dropdown-item @click="goInventory(row)">库存查询</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !rows.length" description="暂无匹配 SKU" />
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />
    </div>

    <el-dialog v-model="detailVisible" :title="`产品详情 · ${detailRow?.sku || ''}`" width="520px">
      <template v-if="detailRow">
        <dl class="detail-dl">
          <dt>SKU</dt><dd class="mono">{{ detailRow.sku }}</dd>
          <dt>SPU</dt><dd>{{ detailRow.spu || '—' }}</dd>
          <dt>商品名</dt><dd>{{ detailRow.productName }}</dd>
          <dt>规格</dt><dd>{{ detailRow.spec || '—' }}</dd>
          <dt>条码</dt><dd>{{ detailRow.barcode || '—' }}</dd>
          <dt>品类/品牌</dt><dd>{{ detailRow.category || '—' }} / {{ detailRow.brand || '—' }}</dd>
          <dt>客户申报(cm)</dt><dd>{{ detailRow.customerDimLabel || '—' }}</dd>
          <dt>仓库实测(cm)</dt><dd>{{ detailRow.measuredDimLabel || '—' }}</dd>
          <dt>仓租计费(cm)</dt><dd>{{ detailRow.billingDimLabel || '—' }}<span v-if="detailRow.billingDimSource" class="lbl">（{{ detailRow.billingDimSource === 'measured' ? '优先实测' : detailRow.billingDimSource === 'customer' ? '客户申报' : '—' }}）</span></dd>
          <dt>重量(kg)</dt><dd>{{ detailRow.weightLabel || '—' }}</dd>
          <dt>申报成本</dt><dd>{{ detailRow.costRmb != null ? detailRow.costRmb : '—' }}</dd>
          <dt>状态</dt><dd>{{ detailRow.statusLabel }}</dd>
          <dt>销售状态</dt><dd>{{ detailRow.salesStatus }}</dd>
          <dt>添加时间</dt><dd>{{ fmtTime(detailRow.createdAt) }}</dd>
          <dt>更新时间</dt><dd>{{ fmtTime(detailRow.updatedAt) }}</dd>
        </dl>
      </template>
    </el-dialog>

    <el-dialog
      v-model="editVisible"
      :title="`编辑 · ${editRow?.sku || ''}`"
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

.toolbar-hint {
  font-size: 12px;
  color: #909399;
}

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

.attr-list {
  font-size: 11px;
  line-height: 1.55;
  color: #606266;
}

.sales-ok { color: #303133; font-size: 12px; }
.sales-muted { color: #909399; font-size: 12px; }

.more-btn {
  padding: 4px 8px;
  font-size: 12px;
}

.gear {
  margin-right: 2px;
}

.detail-dl {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 13px;
}

.detail-dl dt {
  color: #909399;
  margin: 0;
}

.detail-dl dd {
  margin: 0;
  color: #303133;
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
