<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { dashboardApi, profitApi } from '@/api/client.js'
import { num } from '@/api/mappers.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import ListPagination from '@/components/ListPagination.vue'

const period = ref('month')
const tab = ref('profit')
const dim = ref('sku')
const loading = ref(false)

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

function fmtMoney(v: number) {
  return `¥ ${v.toLocaleString()}`
}

function fmtMargin(rate: number, sales: number, profit: number) {
  const pct = rate ? rate * 100 : sales ? (profit / sales) * 100 : 0
  return `${pct.toFixed(1)}%`
}

async function loadAll() {
  loading.value = true
  try {
    const [stats, profitSummary, detail] = await Promise.all([
      dashboardApi.stats(),
      profitApi.summary({ period: period.value }),
      profitApi.detail({ period: period.value }),
    ])

    const sales = num(profitSummary.salesAmount)
    const cost = num(profitSummary.totalCost)
    const gross = num(profitSummary.grossProfit)
    const rate = num(profitSummary.profitRate)

    summary.value = [
      { label: '营业收入', value: fmtMoney(sales), change: '—', tone: 'success' },
      { label: '采购成本', value: fmtMoney(cost), change: '—', tone: '' },
      { label: '物流费用', value: '—', change: '—', tone: '' },
      { label: '毛利润', value: fmtMoney(gross), change: '—', tone: 'success' },
      { label: '毛利率', value: `${rate}%`, change: '—', tone: 'success' },
      { label: '在库SKU', value: String(stats.products ?? 0), change: '—', tone: '' },
    ]

    const rows = detail || []
    profitRows.value = rows.map((row: any) => ({
      dim: row.sku || row.productName || '—',
      revenue: fmtMoney(num(row.salesAmount)),
      cost: fmtMoney(num(row.totalCost)),
      freight: '—',
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

onMounted(loadAll)
watch(period, loadAll)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">利润 / 采购分析</span>
        <el-radio-group v-model="period" size="small">
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="quarter">本季度</el-radio-button>
          <el-radio-button value="year">本年度</el-radio-button>
        </el-radio-group>
      </div>
    </template>

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
      <el-empty v-if="!purchaseRows.length" description="暂无采购分析数据" :image-size="60" style="margin-top:16px" />
    </template>
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
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
