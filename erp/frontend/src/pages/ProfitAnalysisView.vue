<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { customerApi, dashboardApi, profitApi, supplierApi } from '@/api/client.js'
import { num } from '@/api/mappers.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import ListPagination from '@/components/ListPagination.vue'

const period = ref('year')
const dateRange = ref<string[]>([])
const keyword = ref('')
const customerId = ref<number | ''>('')
const supplierId = ref<number | ''>('')
const tab = ref('profit')
const dim = ref('sku')
const loading = ref(false)
const customers = ref<{ id: number; name: string }[]>([])
const suppliers = ref<{ id: number; name: string }[]>([])

const summary = ref([
  { label: '营业收入', value: '—', change: '—', tone: 'success' },
  { label: '采购成本', value: '—', change: '—', tone: '' },
  { label: '物流费用', value: '—', change: '—', tone: '' },
  { label: '毛利润', value: '—', change: '—', tone: 'success' },
  { label: '毛利率', value: '—', change: '—', tone: 'success' },
  { label: '在库SKU', value: '—', change: '—', tone: '' },
])

const topProducts = ref<{ name: string; sku: string; revenue: string; qty: number; margin: string }[]>([])
const profitRows = ref<{ dim: string; revenue: string; cost: string; freight: string; profit: string; margin: string }[]>([])
const purchaseRows = ref<{ dim: string; poCount: number; totalAmt: string; avgLead: string; onTime: string; quality: string }[]>([])

const { page: rankPage, pageSize: rankPageSize, total: rankTotal, pagedItems: rankPagedItems } = useTablePagination(topProducts)
const { page: profitPage, pageSize: profitPageSize, total: profitTotal, pagedItems: profitPagedItems } = useTablePagination(profitRows)
const { page: purchasePage, pageSize: purchasePageSize, total: purchaseTotal, pagedItems: purchasePagedItems } = useTablePagination(purchaseRows)

const periodLabel = computed(() => {
  if (period.value === 'custom') {
    const from = dateRange.value?.[0]
    const to = dateRange.value?.[1]
    if (from || to) return `${from || '起始'} ~ ${to || '至今'}`
    return '自定义日期'
  }
  return { month: '本月', quarter: '本季度', year: '本年度', all: '全部时间' }[period.value] || '本年度'
})

function queryParams() {
  const custom = period.value === 'custom'
  return {
    period: period.value,
    dateFrom: custom ? dateRange.value?.[0] || undefined : undefined,
    dateTo: custom ? dateRange.value?.[1] || undefined : undefined,
    keyword: keyword.value.trim() || undefined,
    customerId: customerId.value || undefined,
    supplierId: supplierId.value || undefined,
    dim: dim.value,
  }
}

function fmtMoney(v: number) {
  return `¥ ${v.toLocaleString()}`
}

function fmtMargin(rate: number, sales: number, profit: number) {
  const pct = rate ? rate * 100 : sales ? (profit / sales) * 100 : 0
  return `${pct.toFixed(1)}%`
}

async function loadLookups() {
  const [custRes, supRes] = await Promise.all([
    customerApi.list({ pageSize: 200 }).catch(() => ({ items: [] })),
    supplierApi.list({ pageSize: 200 }).catch(() => ({ items: [] })),
  ])
  customers.value = (custRes.items || []).map((c: any) => ({
    id: Number(c.id),
    name: c.customerName || c.customerCode,
  }))
  suppliers.value = (supRes.items || []).map((s: any) => ({
    id: Number(s.id),
    name: s.supplierName || s.supplierCode || s.name,
  }))
}

async function loadAll() {
  loading.value = true
  try {
    const params = queryParams()
    const [stats, profitSummary, detail] = await Promise.all([
      dashboardApi.stats(),
      profitApi.summary(params),
      profitApi.detail(params),
    ])

    const sales = num(profitSummary.salesAmount)
    const cost = num(profitSummary.totalCost)
    const freight = num(profitSummary.freightCost)
    const gross = num(profitSummary.grossProfit)
    const rate = num(profitSummary.profitRate)

    summary.value = [
      { label: '营业收入', value: fmtMoney(sales), change: '客户结算入账', tone: 'success' },
      { label: '采购成本', value: fmtMoney(cost - freight), change: '成本台账', tone: '' },
      { label: '物流费用', value: fmtMoney(freight), change: '运费/海运', tone: '' },
      { label: '毛利润', value: fmtMoney(gross), change: '营收 − 成本', tone: 'success' },
      { label: '毛利率', value: `${rate}%`, change: periodLabel.value, tone: 'success' },
      { label: '在库SKU', value: String(profitSummary.skuCount ?? stats.products ?? 0), change: '—', tone: '' },
    ]

    purchaseRows.value = (profitSummary.purchase || []).map((row: any) => ({
      dim: row.dim,
      poCount: row.poCount,
      totalAmt: fmtMoney(num(row.totalAmt)),
      avgLead: row.avgLead || '—',
      onTime: row.onTime || '—',
      quality: row.quality || '—',
    }))

    const rows = detail || []
    profitRows.value = rows.map((row: any) => ({
      dim: row.sku || row.productName || '—',
      revenue: fmtMoney(num(row.salesAmount)),
      cost: fmtMoney(num(row.totalCost)),
      freight: fmtMoney(num(row.freight)),
      profit: fmtMoney(num(row.grossProfit)),
      margin: fmtMargin(num(row.profitRate), num(row.salesAmount), num(row.grossProfit)),
    }))

    topProducts.value = rows.slice(0, 20).map((row: any) => {
      const salesAmt = num(row.salesAmount)
      const margin = num(row.profitRate)
        ? (num(row.profitRate) * 100).toFixed(1)
        : salesAmt
          ? ((num(row.grossProfit) / salesAmt) * 100).toFixed(1)
          : '0'
      return {
        name: row.productName || row.sku || '—',
        sku: row.sku || '—',
        revenue: fmtMoney(salesAmt),
        qty: row.salesQty ?? 0,
        margin: `${margin}%`,
      }
    })
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  period.value = 'year'
  dateRange.value = []
  keyword.value = ''
  customerId.value = ''
  supplierId.value = ''
  loadAll()
}

function onPeriodChange(value: string) {
  if (value !== 'custom') {
    dateRange.value = []
    loadAll()
  }
}

onMounted(async () => {
  await loadLookups()
  await loadAll()
})
watch(dim, loadAll)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <div>
          <div class="page-title">利润 / 采购分析</div>
          <p class="page-subtitle">按时间、客户、供应商和关键词筛选营收、成本与采购表现</p>
        </div>
      </div>
    </template>

    <div class="filter-bar">
      <el-radio-group v-model="period" size="small" @change="onPeriodChange">
        <el-radio-button value="month">本月</el-radio-button>
        <el-radio-button value="quarter">本季度</el-radio-button>
        <el-radio-button value="year">本年度</el-radio-button>
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="custom">自定义</el-radio-button>
      </el-radio-group>
      <el-date-picker
        v-if="period === 'custom'"
        v-model="dateRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        size="small"
        clearable
        style="width:260px"
      />
      <el-input
        v-model="keyword"
        clearable
        size="small"
        placeholder="SKU / 商品 / 客户 / 供应商"
        style="width:220px"
        @keyup.enter="loadAll"
      />
      <el-select v-model="customerId" placeholder="全部客户" clearable size="small" filterable style="width:160px">
        <el-option v-for="c in customers" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="supplierId" placeholder="全部供应商" clearable size="small" filterable style="width:160px">
        <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
      </el-select>
      <el-button type="primary" size="small" @click="loadAll">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
      <span class="filter-summary">{{ periodLabel }}</span>
    </div>

    <div class="kpi-strip">
      <div v-for="s in summary" :key="s.label" class="kpi-item">
        <div class="kpi-value">{{ s.value }}</div>
        <div class="kpi-label">{{ s.label }}</div>
        <div class="kpi-change" :class="s.tone">{{ s.change }}</div>
      </div>
    </div>

    <el-divider />

    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="利润分析" name="profit" />
      <el-tab-pane label="采购分析" name="purchase" />
    </el-tabs>

    <template v-if="tab === 'profit'">
      <el-radio-group v-model="dim" size="small" style="margin-bottom:12px">
        <el-radio-button value="customer">按客户</el-radio-button>
        <el-radio-button value="sku">按SKU</el-radio-button>
        <el-radio-button value="channel">按渠道</el-radio-button>
      </el-radio-group>
      <el-table :data="profitPagedItems" stripe border size="small">
        <el-table-column prop="dim" :label="dim === 'customer' ? '客户' : dim === 'sku' ? 'SKU' : '渠道'" min-width="160" />
        <el-table-column prop="revenue" label="营收" width="120" align="right" />
        <el-table-column prop="cost" label="采购成本" width="120" align="right" />
        <el-table-column prop="freight" label="物流费" width="100" align="right" />
        <el-table-column prop="profit" label="毛利润" width="120" align="right">
          <template #default="{ row }"><span class="profit-positive">{{ row.profit }}</span></template>
        </el-table-column>
        <el-table-column prop="margin" label="毛利率" width="90" align="right">
          <template #default="{ row }"><span class="profit-positive">{{ row.margin }}</span></template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="profitPage" v-model:page-size="profitPageSize" :total="profitTotal" />
      <el-empty v-if="!profitRows.length" description="当前筛选条件下暂无利润明细。可改成「全部」或放宽日期后再查。" :image-size="56" style="margin-top:12px" />

      <el-divider />
      <div class="section-title">商品销售排行</div>
      <el-table :data="rankPagedItems" stripe border size="small">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="name" label="商品名" min-width="150" />
        <el-table-column prop="sku" label="SKU" width="110">
          <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
        </el-table-column>
        <el-table-column prop="revenue" label="营收" width="120" align="right" />
        <el-table-column prop="qty" label="销量" width="90" align="right">
          <template #default="{ row }">{{ row.qty.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="margin" label="毛利率" width="90" align="right" />
      </el-table>
      <ListPagination v-model:page="rankPage" v-model:page-size="rankPageSize" :total="rankTotal" />
    </template>

    <template v-else>
      <el-table :data="purchasePagedItems" stripe border size="small">
        <el-table-column prop="dim" label="供应商" min-width="160" />
        <el-table-column prop="poCount" label="PO数" width="70" align="center" />
        <el-table-column prop="totalAmt" label="总金额" width="120" align="right" />
        <el-table-column prop="avgLead" label="平均交期" width="90" align="center" />
        <el-table-column prop="onTime" label="准时率" width="80" align="center" />
        <el-table-column prop="quality" label="质量评级" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.quality === '优' ? 'success' : 'warning'" size="small">{{ row.quality }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="purchasePage" v-model:page-size="purchasePageSize" :total="purchaseTotal" />
      <el-empty v-if="!purchaseRows.length" description="当前筛选条件下暂无采购分析数据" :image-size="60" style="margin-top:16px" />
    </template>
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.page-subtitle { margin-top:4px; color:var(--text-muted); font-size:12px; }
.filter-bar {
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  align-items:center;
  margin-bottom:14px;
}
.filter-summary { color:var(--text-muted); font-size:12px; margin-left:4px; }
.section-title { font-size:14px; font-weight:650; color:#e2e8f0; margin-bottom:10px; }
.kpi-strip {
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
  gap:12px;
  background:transparent;
  border:0;
}
.kpi-item {
  padding:16px;
  min-height:88px;
  text-align:center;
  border:1px solid rgba(99,102,241,0.16);
  border-radius:14px;
  background:linear-gradient(145deg, rgba(18,17,48,0.86), rgba(10,9,25,0.72));
  box-shadow:0 12px 32px rgba(0,0,0,0.14);
}
.kpi-value { font-size:20px; color:#f8fafc; font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.kpi-label { font-size:11px; color:#718096; margin-top:4px; }
.kpi-change { font-size:11px; margin-top:2px; }
.kpi-change.success { color:#34d399; }
.profit-positive { color:#1f9d92; font-weight:600; }
.mono { font-family:var(--font-mono); font-size:12px; }
</style>
