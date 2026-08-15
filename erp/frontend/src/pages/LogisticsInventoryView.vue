<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { inventoryApi, warehouseApi } from '@/api/client.js'
import { mapInventory, mapWarehouse } from '@/api/mappers.ts'
import { fmtTime } from '@/api/mappers.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const router = useRouter()
const { exportTask } = useRowActions()

const skuQ = ref('')
const nameQ = ref('')
const warehouse = ref('all')
const onlyAvailable = ref(true)
const page = ref(1)
const pageSize = ref(20)
const listTotal = ref(0)
const loading = ref(false)
const rows = ref<ReturnType<typeof mapInventory>[]>([])
const summary = ref({ available: 0, total: 0, locked: 0 })
const logisticsWarehouses = ref<any[]>([])
const detailVisible = ref(false)
const detailRow = ref<any>(null)

const logVisible = ref(false)
const logLoading = ref(false)
const logSku = ref('')
const logWarehouse = ref('')
const logRows = ref<any[]>([])

const CHANGE_LABEL: Record<string, string> = {
  logistics_receive: '中转仓收货',
  inbound_allocate: '发运扣减',
  adjust: '调整',
}

async function loadWarehouses() {
  try {
    const res = await warehouseApi.list({ type: 'logistics' })
    logisticsWarehouses.value = (Array.isArray(res) ? res : res.items || []).map(mapWarehouse)
  } catch {
    logisticsWarehouses.value = []
  }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      page: page.value,
      pageSize: pageSize.value,
      warehouseType: 'logistics',
    }
    if (warehouse.value !== 'all') params.warehouseCode = warehouse.value
    if (onlyAvailable.value) params.onlyAvailable = 'true'
    const kw = [skuQ.value.trim(), nameQ.value.trim()].filter(Boolean).join(' ')
    if (kw) params.keyword = kw
    const res = await inventoryApi.query(params)
    rows.value = (res.items || []).map(mapInventory)
    listTotal.value = res.total ?? rows.value.length
    if (res.summary) summary.value = res.summary
  } catch {
    rows.value = []
    listTotal.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function reset() {
  skuQ.value = ''
  nameQ.value = ''
  warehouse.value = 'all'
  onlyAvailable.value = true
  page.value = 1
  load()
}

function detail(row: any) {
  detailRow.value = row
  detailVisible.value = true
}

function openDetailLogs() {
  if (!detailRow.value) return
  const row = detailRow.value
  detailVisible.value = false
  openLogs(row)
}

async function openLogs(row: any) {
  logSku.value = row.sku
  logWarehouse.value = row.warehouse
  logVisible.value = true
  logLoading.value = true
  try {
    const res = await inventoryApi.logs(row.sku, { warehouseCode: row.warehouse })
    logRows.value = (res || []).map((l: any) => ({
      ...l,
      changeLabel: CHANGE_LABEL[l.changeType] || l.changeType,
      time: fmtTime(l.createdAt),
    }))
  } catch {
    logRows.value = []
  } finally {
    logLoading.value = false
  }
}

function goCreateInbound(row?: any) {
  const q: Record<string, string> = {}
  if (row?.warehouse) q.wh = row.warehouse
  if (row?.sku) q.sku = row.sku
  router.push({ path: '/inbound/create', query: q })
}

watch([page, pageSize], () => load())

onMounted(async () => {
  await loadWarehouses()
  await load()
})
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">中转仓库存查询</span>
        <div class="header-actions">
          <el-button v-if="rows.length" size="small" @click="exportTask('中转仓库存')">导出</el-button>
          <el-button type="primary" size="small" @click="goCreateInbound()">创建入库单</el-button>
        </div>
      </div>
    </template>

    <div class="callout info">
      <div class="callout-title">物流中转仓在库</div>
      <div class="callout-body">
        展示采购收货写入中转仓的 SKU 库存；「可用」数量可用于创建海外入库单，发运后通过「发运扣减」流水扣减。
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi"><strong>{{ listTotal }}</strong><span>库存行数</span></div>
      <div class="kpi ok"><strong>{{ summary.total.toLocaleString() }}</strong><span>在库总量</span></div>
      <div class="kpi"><strong>{{ summary.available.toLocaleString() }}</strong><span>可用总量</span></div>
      <div class="kpi warn"><strong>{{ summary.locked.toLocaleString() }}</strong><span>锁定总量</span></div>
    </div>

    <div class="filter-bar">
      <el-input v-model="skuQ" placeholder="SKU" clearable style="width:130px" size="small" @keyup.enter="search" />
      <el-input v-model="nameQ" placeholder="商品名称" clearable style="width:150px" size="small" @keyup.enter="search" />
      <el-select v-model="warehouse" size="small" style="width:180px" placeholder="中转仓">
        <el-option label="全部中转仓" value="all" />
        <el-option
          v-for="wh in logisticsWarehouses"
          :key="wh.code"
          :label="`${wh.name} (${wh.code})`"
          :value="wh.code"
        />
      </el-select>
      <el-checkbox v-model="onlyAvailable" @change="search">仅显示可用 &gt; 0</el-checkbox>
      <span class="spacer" />
      <el-button type="primary" size="small" @click="search">查询</el-button>
      <el-button size="small" @click="reset">重置</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" stripe border size="small">
      <el-table-column label="中转仓" width="120">
        <template #default="{ row }">
          <div class="cell-stack">
            <span>{{ row.warehouseName }}</span>
            <span class="sub mono">{{ row.warehouse }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="SKU" width="110">
        <template #default="{ row }">
          <span class="mono">{{ row.sku }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="商品名" min-width="140" show-overflow-tooltip />
      <el-table-column prop="spec" label="规格" width="80">
        <template #default="{ row }">{{ row.spec || '—' }}</template>
      </el-table-column>
      <el-table-column label="在库总量" width="90" align="right">
        <template #default="{ row }">{{ row.total.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="可用" width="80" align="right">
        <template #default="{ row }">
          <strong :class="{ ok: row.available > 0 }">{{ row.available.toLocaleString() }}</strong>
        </template>
      </el-table-column>
      <el-table-column label="锁定" width="70" align="right">
        <template #default="{ row }">
          <span :class="{ warn: row.locked > 0 }">{{ row.locked }}</span>
        </template>
      </el-table-column>
      <el-table-column label="最近单号" width="120">
        <template #default="{ row }"><span class="mono sub">{{ row.referenceNo || '—' }}</span></template>
      </el-table-column>
      <el-table-column label="最近变动" width="100">
        <template #default="{ row }">{{ row.lastInboundDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
          <el-button link type="primary" size="small" @click="openLogs(row)">流水</el-button>
          <el-button v-if="row.available > 0" link type="primary" size="small" @click="goCreateInbound(row)">发运</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !rows.length" description="暂无中转仓库存，请先在「物流中转仓」登记 PO 收货" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />

    <el-dialog
      v-model="detailVisible"
      :title="`库存详情 · ${detailRow?.sku || ''}`"
      width="680px"
      class="inventory-detail-dialog"
      destroy-on-close
    >
      <div v-if="detailRow" class="inventory-detail">
        <div class="detail-identity">
          <div>
            <div class="detail-eyebrow">中转仓库存单元</div>
            <div class="detail-product">{{ detailRow.name || '未命名商品' }}</div>
            <div class="detail-codes">
              <span class="mono">{{ detailRow.sku }}</span>
              <span>{{ detailRow.spec || '无规格信息' }}</span>
            </div>
          </div>
          <div class="warehouse-badge">
            <strong>{{ detailRow.warehouseName || detailRow.warehouse }}</strong>
            <span class="mono">{{ detailRow.warehouse }}</span>
          </div>
        </div>

        <div class="stock-balance">
          <div class="stock-metric total">
            <span>在库总量</span>
            <strong>{{ Number(detailRow.total || 0).toLocaleString() }}</strong>
          </div>
          <div class="stock-divider" />
          <div class="stock-metric available">
            <span>可发数量</span>
            <strong>{{ Number(detailRow.available || 0).toLocaleString() }}</strong>
          </div>
          <div class="stock-divider" />
          <div class="stock-metric locked">
            <span>已锁定</span>
            <strong>{{ Number(detailRow.locked || 0).toLocaleString() }}</strong>
          </div>
        </div>

        <el-descriptions :column="2" border class="detail-meta">
          <el-descriptions-item label="最近关联单号">
            <span class="mono">{{ detailRow.referenceNo || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="最近库存变动">{{ detailRow.lastInboundDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="可用率">
            {{ detailRow.total > 0 ? `${((detailRow.available / detailRow.total) * 100).toFixed(1)}%` : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="库存状态">
            <el-tag v-if="detailRow.available > 0" type="success" size="small">可发运</el-tag>
            <el-tag v-else type="info" size="small">暂无可用</el-tag>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="openDetailLogs">查看库存流水</el-button>
        <el-button
          v-if="detailRow?.available > 0"
          type="primary"
          @click="detailVisible = false; goCreateInbound(detailRow)"
        >
          创建入库单
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="logVisible" :title="`库存流水 · ${logSku} @ ${logWarehouse}`" width="640px">
      <el-table v-loading="logLoading" :data="logRows" border size="small" max-height="360">
        <el-table-column prop="time" label="时间" width="130" />
        <el-table-column prop="changeLabel" label="类型" width="100" />
        <el-table-column label="变动" width="80" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.changeQty >= 0 ? '#1f9d92' : '#e85d5d' }">
              {{ row.changeQty >= 0 ? '+' : '' }}{{ row.changeQty }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="结存" width="80" align="right">
          <template #default="{ row }">{{ row.afterQty }}</template>
        </el-table-column>
        <el-table-column prop="referenceNo" label="关联单号" width="120">
          <template #default="{ row }"><span class="mono">{{ row.referenceNo || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
      </el-table>
      <el-empty v-if="!logLoading && !logRows.length" description="暂无流水" :image-size="48" />
    </el-dialog>
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; }
.callout {
  padding:12px 14px; border-radius:14px; margin-bottom:14px; font-size:13px;
  background:linear-gradient(110deg, rgba(99,102,241,0.12), rgba(6,182,212,0.045));
  border:1px solid rgba(99,102,241,0.2); border-left:3px solid #818cf8; color:#a5b4c8;
}
.callout-title { font-weight:600; margin-bottom:4px; color:#e0e7ff; }
.callout-body { line-height:1.5; }
.kpi-row {
  display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:14px;
}
.kpi {
  padding:12px 14px; border-radius:14px;
  background:linear-gradient(145deg, rgba(18,17,48,0.86), rgba(10,9,25,0.72));
  border:1px solid rgba(99,102,241,0.16);
  box-shadow:0 12px 32px rgba(0,0,0,0.14);
  display:flex; flex-direction:column; gap:4px;
}
.kpi strong { font-size:20px; font-family:var(--font-mono); color:#f8fafc; font-variant-numeric:tabular-nums; }
.kpi span { font-size:11px; color:#718096; }
.kpi.ok strong { color:#34d399; }
.kpi.warn strong { color:#fbbf24; }
.filter-bar {
  display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px;
}
.spacer { flex:1; }
.mono { font-family:var(--font-mono,Consolas,monospace); font-size:12px; }
.cell-stack { display:flex; flex-direction:column; gap:2px; font-size:12px; }
.sub { color:var(--el-text-color-secondary); font-size:11px; }
.ok { color:#1f9d92; }
.warn { color:#e8953a; }
.inventory-detail { display:flex; flex-direction:column; gap:18px; }
.detail-identity {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:20px;
  padding:2px 2px 0;
}
.detail-eyebrow {
  margin-bottom:5px;
  color:var(--el-text-color-secondary);
  font-size:11px;
  letter-spacing:.08em;
}
.detail-product {
  color:var(--el-text-color-primary);
  font-size:18px;
  font-weight:650;
  line-height:1.35;
}
.detail-codes {
  display:flex;
  flex-wrap:wrap;
  gap:8px 14px;
  margin-top:7px;
  color:var(--el-text-color-secondary);
  font-size:12px;
}
.warehouse-badge {
  min-width:170px;
  padding:10px 12px;
  border:1px solid var(--el-border-color-lighter);
  border-radius:8px;
  background:var(--el-fill-color-light);
  text-align:right;
}
.warehouse-badge strong,
.warehouse-badge span { display:block; }
.warehouse-badge strong { color:var(--el-text-color-primary); font-size:13px; }
.warehouse-badge span { margin-top:3px; color:var(--el-text-color-secondary); }
.stock-balance {
  display:grid;
  grid-template-columns:1fr 1px 1fr 1px 1fr;
  align-items:stretch;
  padding:16px 18px;
  border:1px solid var(--el-border-color-lighter);
  border-radius:10px;
  background:var(--el-fill-color-extra-light);
}
.stock-divider { background:var(--el-border-color-lighter); }
.stock-metric {
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:5px;
  min-height:58px;
}
.stock-metric span { color:var(--el-text-color-secondary); font-size:12px; }
.stock-metric strong {
  color:var(--el-text-color-primary);
  font-family:var(--font-mono,Consolas,monospace);
  font-size:24px;
  font-variant-numeric:tabular-nums;
}
.stock-metric.available strong { color:var(--el-color-success); }
.stock-metric.locked strong { color:var(--el-color-warning); }
.detail-meta { width:100%; }
@media (max-width: 840px) {
  .kpi-row { grid-template-columns:repeat(2,1fr); }
  .detail-identity { flex-direction:column; }
  .warehouse-badge { width:100%; min-width:0; text-align:left; }
  .stock-balance { padding:12px 8px; }
  .stock-metric strong { font-size:19px; }
}
</style>
