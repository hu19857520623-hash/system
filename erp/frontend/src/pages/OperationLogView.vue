<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { operationLogApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers.ts'
import { useListLoader } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { showDetail } = useRowActions()

const filterModule = ref('')
const filterAction = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const keyword = ref('')

const MODULE_OPTIONS = [
  { value: '', label: '全部模块' },
  { value: 'purchase', label: '采购' },
  { value: 'product_audit', label: '产品审核' },
  { value: 'logistics_receipt', label: '物流收货' },
  { value: 'inbound', label: '入库' },
  { value: 'inventory', label: '库存' },
  { value: 'product', label: '商品主数据' },
  { value: 'warehouse_location', label: '库位管理' },
]

const listParams = computed(() => ({
  pageSize: 100,
  module: filterModule.value || undefined,
  action: filterAction.value || undefined,
  dateFrom: dateFrom.value || undefined,
  dateTo: dateTo.value || undefined,
  keyword: keyword.value.trim() || undefined,
}))

function mapRow(row: any) {
  return {
    id: row.id,
    operator: row.operatorName || '—',
    module: row.moduleLabel || row.module,
    action: row.actionLabel || row.action,
    target: row.targetId || '—',
    targetType: row.targetType || '—',
    time: fmtTime(row.createdAt),
    detail: row.detail,
    _raw: row,
  }
}

const { loading, items: entries, load } = useListLoader(async () => {
  const res = await operationLogApi.list(listParams.value)
  return { items: (res.items || []).map(mapRow) }
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(entries)

watch([filterModule, filterAction, dateFrom, dateTo, keyword], () => {
  resetPage()
  load()
})

function resetFilters() {
  filterModule.value = ''
  filterAction.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  keyword.value = ''
}

function detail(row: any) {
  const detailLines: [string, string][] = [
    ['操作人', row.operator],
    ['模块', row.module],
    ['操作', row.action],
    ['对象类型', row.targetType],
    ['对象编号', row.target],
    ['时间', row.time],
  ]
  if (row.detail && typeof row.detail === 'object') {
    detailLines.push(['详情', JSON.stringify(row.detail, null, 2)])
  }
  showDetail(`操作日志 · #${row.id}`, detailLines)
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">操作日志</span>
        <div class="header-actions">
          <el-input v-model="keyword" placeholder="搜索单号/操作人" clearable style="width: 160px" size="small" />
        </div>
      </div>
    </template>

    <div class="callout info">
      <div class="callout-title">业务操作留痕</div>
      <div class="callout-body">
        记录采购、审核、收货、入库、SKU 参数修改、库位调整等关键步骤，展示操作账号与时间，便于追溯责任。
      </div>
    </div>

    <div class="filter-row">
      <el-select v-model="filterModule" placeholder="模块" size="small" style="width: 140px" clearable>
        <el-option v-for="opt in MODULE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
      <el-input v-model="filterAction" placeholder="操作类型" size="small" style="width: 120px" clearable />
      <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" size="small" style="width: 130px" />
      <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" size="small" style="width: 130px" />
      <el-button size="small" @click="resetFilters">重置</el-button>
    </div>

    <el-table :data="pagedItems" stripe border size="small">
      <el-table-column prop="time" label="操作时间" width="140" />
      <el-table-column prop="operator" label="操作账号" width="100" />
      <el-table-column prop="module" label="模块" width="100" />
      <el-table-column prop="action" label="操作" width="120" />
      <el-table-column prop="target" label="对象编号" min-width="140">
        <template #default="{ row }"><span class="mono">{{ row.target }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>
</template>

<style scoped>
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.callout {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}
.callout.info {
  background: #eef6ff;
  border: 1px solid #c5dff8;
  color: #3d4f63;
}
.callout-title { font-weight: 600; margin-bottom: 4px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
</style>
