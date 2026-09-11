<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { inventoryApi, warehouseApi } from '@/api/client.js'
import { fmtTime, mapInventory, mapWarehouse } from '@/api/mappers.ts'
import { useRowActions } from '@/composables/useRowActions'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'
import StockFillBar from '@/components/ui/StockFillBar.vue'

const router = useRouter()
const app = useAppStore()
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
  logistics_transfer: '中转仓调拨',
  adjust: '调整',
}

const canTransfer = computed(() => app.hasPerm('logistics_wh.manage') || app.hasPerm('logistics_wh.receive'))
const logisticsCodes = computed(() => new Set(logisticsWarehouses.value.map((wh) => wh.code).filter(Boolean)))

function canTransferRow(row: any) {
  return canTransfer.value && Number(row?.available) > 0 && logisticsCodes.value.has(row?.warehouse)
}

const transferVisible = ref(false)
const transferring = ref(false)
const transferForm = ref({
  sku: '',
  name: '',
  fromWarehouse: '',
  fromWarehouseName: '',
  toWarehouse: '',
  qty: 1,
  available: 0,
  remark: '',
})

const transferDestOptions = computed(() =>
  logisticsWarehouses.value.filter((wh) => wh.code && wh.code !== transferForm.value.fromWarehouse && wh.statusCode !== 0),
)

const readyRate = computed(() => {
  if (!summary.value.total) return 0
  return (summary.value.available / summary.value.total) * 100
})

const warehouseLabel = computed(() => {
  if (warehouse.value === 'all') return '全部中转仓'
  const hit = logisticsWarehouses.value.find((wh) => wh.code === warehouse.value)
  return hit ? hit.name : warehouse.value
})

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

function selectWarehouse(code: string) {
  warehouse.value = code
  search()
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

function openTransfer(row: any) {
  if (!canTransfer.value) {
    ElMessage.warning('当前角色不能调拨中转仓库存')
    return
  }
  const dest = logisticsWarehouses.value.find((wh) => wh.code && wh.code !== row.warehouse && wh.statusCode !== 0)
  transferForm.value = {
    sku: row.sku,
    name: row.name || '',
    fromWarehouse: row.warehouse,
    fromWarehouseName: row.warehouseName || row.warehouse,
    toWarehouse: dest?.code || '',
    qty: 1,
    available: Number(row.available) || 0,
    remark: '',
  }
  detailVisible.value = false
  transferVisible.value = true
}

async function submitTransfer() {
  const form = transferForm.value
  if (!form.toWarehouse) {
    ElMessage.warning('请选择调入仓')
    return
  }
  if (!Number.isInteger(form.qty) || form.qty <= 0) {
    ElMessage.warning('调拨数量须为正整数')
    return
  }
  if (form.qty > form.available) {
    ElMessage.warning(`超过可发数量 ${form.available}`)
    return
  }
  transferring.value = true
  try {
    const res = await inventoryApi.transferLogistics({
      sku: form.sku,
      fromWarehouseCode: form.fromWarehouse,
      toWarehouseCode: form.toWarehouse,
      qty: form.qty,
      remark: form.remark.trim() || undefined,
    })
    const destName = transferDestOptions.value.find((wh) => wh.code === form.toWarehouse)?.name || form.toWarehouse
    ElMessage.success(`已调拨 ${form.qty} 件 ${form.sku} 至 ${res.toWarehouseName || destName}`)
    transferVisible.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e?.message || '调拨失败')
  } finally {
    transferring.value = false
  }
}

watch([page, pageSize], () => load())

onMounted(async () => {
  await loadWarehouses()
  await load()
})
</script>

<template>
  <div class="transit-stock-page">
    <el-card shadow="never" class="page-card">
      <div class="page-head">
        <div>
          <p class="eyebrow">国内 · 物流中转</p>
          <h2>中转仓库存</h2>
          <p class="page-desc">采购收货后的在库。可发数量可调到其他中转仓，或发往海外仓；发运和调拨都会从这里扣减。</p>
        </div>
        <div class="head-actions">
          <el-button v-if="rows.length" size="small" @click="exportTask('中转仓库存')">导出</el-button>
        </div>
      </div>

      <div class="stock-board">
        <div class="meter">
          <span class="meter-label">在库</span>
          <strong>{{ summary.total.toLocaleString() }}</strong>
          <span class="meter-sub">{{ listTotal.toLocaleString() }} 个 SKU · {{ warehouseLabel }}</span>
        </div>
        <div class="meter is-ready">
          <span class="meter-label">可发</span>
          <strong>{{ summary.available.toLocaleString() }}</strong>
          <StockFillBar :available="summary.available" :locked="summary.locked" :total="summary.total" :show-percent="false" />
          <span class="fill-key">
            <i class="swatch avail" />可发
            <i class="swatch lock" />锁定
          </span>
        </div>
        <div class="meter is-lock">
          <span class="meter-label">锁定</span>
          <strong>{{ summary.locked.toLocaleString() }}</strong>
          <span class="meter-sub">可发占比 {{ summary.total ? `${readyRate.toFixed(0)}%` : '—' }}</span>
        </div>
      </div>

      <div class="wh-row">
        <button type="button" class="wh-chip" :class="{ on: warehouse === 'all' }" @click="selectWarehouse('all')">
          全部中转仓
        </button>
        <button
          v-for="wh in logisticsWarehouses"
          :key="wh.code"
          type="button"
          class="wh-chip"
          :class="{ on: warehouse === wh.code }"
          @click="selectWarehouse(wh.code)"
        >
          {{ wh.name }}
        </button>
      </div>

      <div class="filter-grid">
        <div class="filter-item">
          <label>SKU</label>
          <el-input v-model="skuQ" placeholder="系统 SKU" clearable size="small" @keyup.enter="search" />
        </div>
        <div class="filter-item">
          <label>商品名</label>
          <el-input v-model="nameQ" placeholder="品名关键词" clearable size="small" @keyup.enter="search" />
        </div>
      </div>
      <div class="filter-actions">
        <el-checkbox v-model="onlyAvailable" @change="search">仅显示可发 &gt; 0</el-checkbox>
        <span class="spacer" />
        <el-button type="primary" size="small" @click="search">查询</el-button>
        <el-button size="small" @click="reset">重置</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="page-card table-panel">
      <el-table
        v-loading="loading"
        :data="rows"
        border
        stripe
        size="small"
        class="stock-table"
        empty-text="暂无中转仓库存"
        header-cell-class-name="stock-table-header"
      >
        <el-table-column label="SKU / 商品" min-width="220">
          <template #default="{ row }">
            <button type="button" class="sku-link" @click="detail(row)">{{ row.sku }}</button>
            <div class="title-cn">{{ row.name || '—' }}</div>
            <div v-if="row.spec" class="title-en">{{ row.spec }}</div>
          </template>
        </el-table-column>
        <el-table-column label="中转仓" width="132">
          <template #default="{ row }">
            <div>{{ row.warehouseName }}</div>
            <div class="mono sub">{{ row.warehouse }}</div>
          </template>
        </el-table-column>
        <el-table-column label="库存构成" min-width="168">
          <template #default="{ row }">
            <StockFillBar :available="row.available" :locked="row.locked" :total="row.total" />
          </template>
        </el-table-column>
        <el-table-column label="库存数量" align="center">
          <el-table-column label="在库" width="84" align="right">
            <template #default="{ row }">
              <span class="qty-num">{{ row.total.toLocaleString() }}</span>
            </template>
          </el-table-column>
          <el-table-column label="可发" width="84" align="right">
            <template #default="{ row }">
              <strong class="qty-num" :class="{ ready: row.available > 0 }">{{ row.available.toLocaleString() }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="锁定" width="72" align="right">
            <template #default="{ row }">
              <span class="qty-num" :class="{ locked: row.locked > 0 }">{{ row.locked.toLocaleString() }}</span>
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="最近变动" width="148">
          <template #default="{ row }">
            <div>{{ row.lastInboundDate || '—' }}</div>
            <div class="mono sub">{{ row.referenceNo || '无关联单' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
            <el-button link type="primary" size="small" @click="openLogs(row)">流水</el-button>
            <el-button v-if="canTransferRow(row)" link type="primary" size="small" @click="openTransfer(row)">调拨</el-button>
            <el-button v-if="row.available > 0" link type="primary" size="small" @click="goCreateInbound(row)">发运</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty
        v-if="!loading && !rows.length"
        description="暂无中转仓库存，请先在「物流中转仓」登记 PO 收货"
      />
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />
    </el-card>

    <el-dialog
      v-model="detailVisible"
      :title="`库存详情 · ${detailRow?.sku || ''}`"
      width="680px"
      class="inventory-detail-dialog erp-detail"
      destroy-on-close
    >
      <div v-if="detailRow" class="inventory-detail">
        <DetailSheet
          :kicker="detailRow.sku"
          :title="detailRow.name || '未命名商品'"
          :subtitle="detailRow.spec || '无规格信息'"
        >
          <template #status>
            <el-tag v-if="detailRow.available > 0" type="success" size="small">可发运</el-tag>
            <el-tag v-else type="info" size="small">暂无可用</el-tag>
          </template>
          <template #metrics>
            <div class="erp-detail__metric">
              <label>在库总量</label>
              <strong>{{ Number(detailRow.total || 0).toLocaleString() }}</strong>
            </div>
            <div class="erp-detail__metric is-accent">
              <label>可发数量</label>
              <strong>{{ Number(detailRow.available || 0).toLocaleString() }}</strong>
            </div>
            <div class="erp-detail__metric">
              <label>已锁定</label>
              <strong>{{ Number(detailRow.locked || 0).toLocaleString() }}</strong>
            </div>
            <div class="erp-detail__metric">
              <label>仓库</label>
              <strong>{{ detailRow.warehouseName || detailRow.warehouse }}</strong>
            </div>
          </template>
          <div class="detail-fill">
            <label>库存构成</label>
            <StockFillBar :available="detailRow.available" :locked="detailRow.locked" :total="detailRow.total" />
          </div>
        </DetailSheet>

        <el-descriptions :column="2" border class="detail-meta">
          <el-descriptions-item label="关联单号">
            <span class="mono">{{ detailRow.referenceNo || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="最近变动">{{ detailRow.lastInboundDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="可发占比">
            {{ detailRow.total > 0 ? `${((detailRow.available / detailRow.total) * 100).toFixed(1)}%` : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="仓库编码">
            <span class="mono">{{ detailRow.warehouse || '—' }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="openDetailLogs">查看库存流水</el-button>
        <el-button
          v-if="canTransferRow(detailRow)"
          @click="openTransfer(detailRow)"
        >
          调拨
        </el-button>
        <el-button
          v-if="detailRow?.available > 0"
          type="primary"
          @click="detailVisible = false; goCreateInbound(detailRow)"
        >
          发运海外仓
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="transferVisible"
      title="中转仓调拨"
      width="480px"
      class="transfer-dialog"
      destroy-on-close
    >
      <el-form label-width="88px">
        <el-form-item label="SKU">
          <div>
            <div class="mono">{{ transferForm.sku }}</div>
            <div v-if="transferForm.name" class="sub">{{ transferForm.name }}</div>
          </div>
        </el-form-item>
        <el-form-item label="调出仓">
          <div>
            <div>{{ transferForm.fromWarehouseName }}</div>
            <div class="mono sub">{{ transferForm.fromWarehouse }} · 可发 {{ transferForm.available.toLocaleString() }}</div>
          </div>
        </el-form-item>
        <el-form-item label="调入仓" required>
          <el-select v-model="transferForm.toWarehouse" placeholder="选择目标中转仓" filterable style="width:100%">
            <el-option
              v-for="wh in transferDestOptions"
              :key="wh.code"
              :label="wh.name"
              :value="wh.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="调拨数量" required>
          <el-input-number
            v-model="transferForm.qty"
            :min="1"
            :max="Math.max(1, transferForm.available)"
            :step="1"
            controls-position="right"
            style="width:160px"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="transferForm.remark" placeholder="可选，如集货、腾仓" maxlength="120" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferVisible = false">取消</el-button>
        <el-button type="primary" :loading="transferring" :disabled="!transferForm.toWarehouse" @click="submitTransfer">
          确认调拨
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="logVisible" :title="`库存流水 · ${logSku} @ ${logWarehouse}`" width="640px">
      <el-table v-loading="logLoading" :data="logRows" border size="small" max-height="360">
        <el-table-column prop="time" label="时间" width="130" />
        <el-table-column prop="changeLabel" label="类型" width="100" />
        <el-table-column label="变动" width="80" align="right">
          <template #default="{ row }">
            <span :class="row.changeQty >= 0 ? 'erp-money' : 'erp-money is-neg'">
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
  </div>
</template>

<style scoped>
.transit-stock-page { display: flex; flex-direction: column; gap: 12px; }
.page-card :deep(.el-card__body) { padding: 16px 18px 18px; }
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--primary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .06em;
}
.page-head h2 { margin: 0; font-size: 20px; font-weight: 650; color: var(--text); }
.page-desc { margin: 6px 0 0; max-width: 520px; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
.head-actions { display: flex; gap: 8px; flex-shrink: 0; }

.stock-board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--border);
}
.meter {
  min-width: 0;
  padding: 14px 16px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.meter-label { color: var(--text-muted); font-size: 12px; }
.meter strong {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 26px;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.meter.is-ready strong { color: #0f766e; }
.meter.is-lock strong { color: #b45309; }
.meter-sub { color: var(--text-muted); font-size: 11px; }
.fill-key {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 11px;
}
.swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 99px;
  vertical-align: 0;
}
.swatch.avail { background: #0f766e; }
.swatch.lock { background: #d97706; }

.wh-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.wh-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 7px 12px;
}
.wh-chip.on {
  border-color: #0f766e;
  background: #ecfdf8;
  color: #115e59;
  font-weight: 600;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 280px));
  gap: 12px 16px;
}
.filter-item { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.filter-item label { color: var(--text-muted); font-size: 12px; }
.filter-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.spacer { flex: 1; }

.table-panel :deep(.el-card__body) { padding: 12px 12px 16px; overflow-x: auto; }
.stock-table { width: 100%; font-size: 12px; }
.stock-table :deep(.stock-table-header) {
  background: var(--table-header-bg) !important;
  color: var(--table-header-text);
  font-weight: 600;
}
.sku-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--el-color-primary);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}
.sku-link:hover { text-decoration: underline; }
.title-cn { margin-top: 2px; color: var(--text); line-height: 1.4; }
.title-en { margin-top: 2px; color: var(--text-muted); font-size: 11px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.sub { color: var(--text-muted); font-size: 11px; }
.qty-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.qty-num.ready { color: #0f766e; }
.qty-num.locked { color: #b45309; }
.inventory-detail { display: flex; flex-direction: column; gap: 18px; }
.detail-fill {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px;
}
.detail-fill label { color: var(--text-muted); font-size: 12px; }
.detail-meta { width: 100%; }

@media (max-width: 900px) {
  .page-head { flex-direction: column; }
  .stock-board { grid-template-columns: 1fr; }
  .filter-grid { grid-template-columns: 1fr; }
}
</style>
