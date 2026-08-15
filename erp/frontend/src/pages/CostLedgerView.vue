<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { costApi } from '@/api/client.js'
import { mapCostLedger } from '@/api/mappers.ts'
import { useListLoader } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { showDetail, exportTask } = useRowActions()

function toBillRow(row: any) {
  const m = mapCostLedger({ ...row, amount: row.amountRmb })
  return {
    id: row.costNo || String(m.id),
    referenceNo: row.referenceNo || '',
    sku: row.sku || '',
    amountRmb: m.amount,
    amountZar: row.amountZar != null ? Number(row.amountZar) : null,
    exchangeRate: row.exchangeRate != null ? Number(row.exchangeRate) : null,
    remark: row.remark || '',
    status: '已核算',
    tone: 'ok',
    costType: row.costType || '',
    costDate: row.costDate ? String(row.costDate).slice(0, 10) : '',
    createdAt: m.time,
    _raw: row,
  }
}

const filters = ref({
  keyword: '',
  costType: '',
  dateRange: [] as string[],
  minAmount: null as number | null,
  maxAmount: null as number | null,
})

const { loading, items: bills, load } = useListLoader(async () => {
  const res = await costApi.list({
    pageSize: 100,
    keyword: filters.value.keyword.trim() || undefined,
    costType: filters.value.costType.trim() || undefined,
    startDate: filters.value.dateRange?.[0] || undefined,
    endDate: filters.value.dateRange?.[1] || undefined,
    minAmount: filters.value.minAmount ?? undefined,
    maxAmount: filters.value.maxAmount ?? undefined,
  })
  return { items: (res.items || []).map(toBillRow), total: res.total }
})

const { page, pageSize, total, pagedItems } = useTablePagination(bills)

const totalAmount = computed(() => bills.value.reduce((sum, row) => sum + Number(row._raw?.amountRmb || 0), 0))

async function applyFilters() {
  page.value = 1
  await load()
}

async function resetFilters() {
  filters.value = { keyword: '', costType: '', dateRange: [], minAmount: null, maxAmount: null }
  page.value = 1
  await load()
}

function detail(row: any) {
  showDetail(`成本台账 · ${row.id}`, [
    ['成本单号', row.id],
    ['费用类型', row.costType],
    ['SKU', row.sku],
    ['关联单号', row.referenceNo],
    ['金额 (RMB)', `¥ ${row.amountRmb.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
    ['金额 (ZAR)', row.amountZar != null ? `R ${row.amountZar.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''],
    ['汇率', row.exchangeRate],
    ['发生日期', row.costDate],
    ['状态', row.status],
    ['创建时间', row.createdAt],
    ['备注', row.remark],
  ])
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <div>
          <div class="page-title">成本台账</div>
          <p class="page-subtitle">按费用类型、业务单号和发生日期追踪成本</p>
        </div>
        <el-button size="small" @click="exportTask('成本台账')">导出</el-button>
      </div>
    </template>
    <div class="filters">
      <el-input v-model="filters.keyword" clearable placeholder="成本单号 / SKU / 关联单号" style="width:220px" @keyup.enter="applyFilters" />
      <el-input v-model="filters.costType" clearable placeholder="费用类型" style="width:140px" @keyup.enter="applyFilters" />
      <el-date-picker v-model="filters.dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width:260px" />
      <el-input-number v-model="filters.minAmount" :min="0" :precision="2" controls-position="right" placeholder="最低金额" style="width:130px" />
      <span class="range-separator">—</span>
      <el-input-number v-model="filters.maxAmount" :min="0" :precision="2" controls-position="right" placeholder="最高金额" style="width:130px" />
      <el-button type="primary" @click="applyFilters">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
      <span class="filter-summary">{{ total }} 条 · 合计 ¥ {{ totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span>
    </div>
    <el-table :data="pagedItems" stripe border size="small" class="cost-table">
      <el-table-column prop="id" label="成本单号" width="140">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="referenceNo" label="关联单号" width="150">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px;color:#2563eb">{{ row.referenceNo }}</span></template>
      </el-table-column>
      <el-table-column prop="sku" label="SKU" min-width="140" />
      <el-table-column prop="costType" label="费用类型" width="100" />
      <el-table-column prop="costDate" label="发生日期" width="110" />
      <el-table-column prop="amountRmb" label="金额 (RMB)" width="120" align="right">
        <template #default="{ row }">¥ {{ row.amountRmb.toLocaleString(undefined, { minimumFractionDigits: 2 }) }}</template>
      </el-table-column>
      <el-table-column prop="amountZar" label="金额 (ZAR)" width="120" align="right">
        <template #default="{ row }">{{ row.amountZar != null ? 'R ' + row.amountZar.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '' }}</template>
      </el-table-column>
      <el-table-column prop="exchangeRate" label="汇率" width="90" align="right">
        <template #default="{ row }">{{ row.exchangeRate ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="(row.tone as any)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }"><el-button link type="primary" size="small" @click="detail(row)">详情</el-button></template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.page-subtitle { margin-top:4px; color:var(--text-muted); font-size:12px; }
.filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
.range-separator { color:var(--el-text-color-secondary); }
.filter-summary { margin-left:auto; color:var(--el-text-color-secondary); font-size:13px; white-space:nowrap; }
</style>
