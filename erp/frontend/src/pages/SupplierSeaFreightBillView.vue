<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { freightBillApi, supplierApi } from '@/api/client.js'
import { fmtTime, num } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

defineOptions({ name: 'SupplierSeaFreightBillView' })
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

type SkuLine = {
  sku: string
  productName?: string
  qty: number
  areaCbm: number
  sharePct: number
}

type ContainerOption = {
  containerNo: string
  shipmentNo?: string
  mode?: string
  poNos?: string
  skuCount?: number
  totalAreaCbm?: number
  skuLines?: SkuLine[]
}

const { exportTask, toast } = useRowActions()

const dialogVisible = ref(false)
const detailVisible = ref(false)
const detailRow = ref<any>(null)
const suppliers = ref<any[]>([])
const containerOptions = ref<ContainerOption[]>([])
const form = ref({
  supplierId: null as number | null,
  totalAmount: '',
  billMonth: '',
  containerCount: 0,
  containerNo: '',
  remark: '',
  mode: 'lcl' as 'lcl' | 'fcl',
})

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  confirmed: { label: '已入账', tone: 'ok' },
  draft: { label: '待入账', tone: 'info' },
  pending: { label: '待确认', tone: 'warn' },
}

function formatArea(value: unknown) {
  const n = Number(value || 0)
  return n > 0 ? n.toFixed(4) : '—'
}

function mapFreight(row: any) {
  const st = STATUS_MAP[row.status] || { label: row.status, tone: 'info' }
  return {
    id: row.billNo,
    supplier: row.supplierName || `供应商 #${row.supplierId}`,
    containerNo: row.containerNo || '',
    type: '海运费',
    amount: num(row.totalAmount).toLocaleString(),
    mode: row.containerCount ? 'FCL' : 'LCL',
    status: st.label,
    tone: st.tone,
    date: fmtTime(row.createdAt).split(' ')[0],
    skuLines: Array.isArray(row.skuLines) ? row.skuLines : [],
    totalAreaCbm: Number(row.totalAreaCbm || 0),
    remark: row.remark || '',
    _raw: row,
  }
}

const { loading, items: expenses, load } = useListLoader(async () => {
  const res = await freightBillApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(mapFreight) }
})

const { page, pageSize, total, pagedItems } = useTablePagination(expenses)
const totalAmount = computed(() =>
  expenses.value.reduce((sum, row) => sum + Number(row._raw?.totalAmount || 0), 0),
)
const pendingCount = computed(() =>
  expenses.value.filter(row => row._raw?.status !== 'confirmed').length,
)
const selectedContainer = computed(() =>
  containerOptions.value.find(item => item.containerNo === form.value.containerNo) || null,
)
const previewLines = computed<SkuLine[]>(() => selectedContainer.value?.skuLines || [])

async function loadSuppliers() {
  try {
    const res = await supplierApi.list({ pageSize: 200 })
    suppliers.value = (res.items || []).map((s: any) => ({
      id: Number(s.id),
      name: s.supplierName || s.supplierCode,
    }))
  } catch {
    suppliers.value = []
  }
}

async function loadContainerOptions() {
  try {
    const res = await freightBillApi.containerOptions()
    containerOptions.value = Array.isArray(res) ? res : (res.items || [])
  } catch {
    containerOptions.value = []
  }
}

function addExpense() {
  const now = new Date()
  form.value = {
    supplierId: suppliers.value[0]?.id ?? null,
    totalAmount: '',
    billMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    containerCount: 0,
    containerNo: '',
    remark: '',
    mode: 'lcl',
  }
  dialogVisible.value = true
}

async function submitExpense() {
  if (!form.value.supplierId) {
    toast('请选择供应商', 'warning')
    return
  }
  if (!form.value.containerNo.trim()) {
    toast('请选择或填写关联柜号', 'warning')
    return
  }
  form.value.containerNo = form.value.containerNo.trim().toUpperCase()
  const amount = parseFloat(form.value.totalAmount)
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('请填写有效金额', 'warning')
    return
  }
  const ok = await withAction(async () => {
    await freightBillApi.create({
      supplierId: form.value.supplierId,
      totalAmount: amount,
      billMonth: form.value.billMonth,
      containerCount: form.value.mode === 'fcl' ? Math.max(1, form.value.containerCount || 1) : 0,
      containerNo: form.value.containerNo.trim(),
      remark: form.value.remark || undefined,
      status: 'draft',
    })
    await load()
  }, '海运费用已录入')
  if (ok) dialogVisible.value = false
}

function detail(row: any) {
  detailRow.value = row
  detailVisible.value = true
}

onMounted(async () => {
  await Promise.all([loadSuppliers(), loadContainerOptions()])
  await load()
})
</script>

<template>
  <el-card v-loading="loading" class="freight-page-card" :class="{ 'is-embedded': embedded }" :shadow="embedded ? 'never' : undefined">
    <template v-if="!embedded" #header>
      <div class="page-header">
        <div>
          <div class="page-title">海运账单</div>
          <p class="page-subtitle">按柜号归集海运费用，并查看各 SKU 分摊面积</p>
        </div>
        <div class="header-actions">
          <el-button type="primary" size="small" @click="addExpense">录入费用</el-button>
          <el-button size="small" @click="exportTask('海运账单')">导出</el-button>
        </div>
      </div>
    </template>
    <div v-if="embedded" class="embedded-toolbar">
      <el-button type="primary" size="small" @click="addExpense">录入费用</el-button>
      <el-button size="small" @click="exportTask('海运账单')">导出</el-button>
    </div>
    <div class="bill-summary">
      <div>
        <span>账单数量</span>
        <strong>{{ total }}</strong>
      </div>
      <div>
        <span>账单总额</span>
        <strong>¥ {{ totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</strong>
      </div>
      <div>
        <span>待处理</span>
        <strong>{{ pendingCount }}</strong>
      </div>
    </div>
    <div class="erp-table-scroll freight-table-scroll">
    <el-table :data="pagedItems" stripe border size="small" class="freight-table">
      <el-table-column prop="id" label="账单编号" min-width="132" show-overflow-tooltip>
        <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="supplier" label="供应商" min-width="140" show-overflow-tooltip />
      <el-table-column prop="containerNo" label="关联柜号" min-width="150" show-overflow-tooltip>
        <template #default="{ row }"><span class="mono linkish">{{ row.containerNo || '—' }}</span></template>
      </el-table-column>
      <el-table-column prop="type" label="费用类型" min-width="96" show-overflow-tooltip />
      <el-table-column prop="amount" label="金额 (RMB)" width="118" align="right">
        <template #default="{ row }">¥ {{ row.amount }}</template>
      </el-table-column>
      <el-table-column prop="mode" label="运输方式" width="88" />
      <el-table-column prop="status" label="状态" width="88">
        <template #default="{ row }">
          <el-tag :type="(row.tone as any)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="date" label="日期" width="96" />
      <el-table-column label="操作" width="72" fixed="right" align="center">
        <template #default="{ row }"><el-button link type="primary" size="small" @click="detail(row)">详情</el-button></template>
      </el-table-column>
    </el-table>
    </div>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>

  <el-dialog v-model="dialogVisible" title="录入海运费用" width="720px" class="freight-entry-dialog">
    <p class="dialog-note">选择柜号后自动带出该柜 SKU、数量和分摊海运面积；保存后生成待入账账单。</p>
    <el-form label-position="top">
      <div class="expense-form-grid">
      <el-form-item label="供应商" required class="span-two">
        <el-select v-model="form.supplierId" placeholder="选择供应商" style="width:100%">
          <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联柜号" required class="span-two">
        <el-select
          v-model="form.containerNo"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入柜号"
          style="width:100%"
        >
          <el-option
            v-for="item in containerOptions"
            :key="item.containerNo"
            :label="item.shipmentNo ? `${item.containerNo} · ${item.shipmentNo}` : item.containerNo"
            :value="item.containerNo"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="账期">
        <el-input v-model="form.billMonth" placeholder="YYYY-MM" />
      </el-form-item>
      <el-form-item label="运输方式">
        <el-radio-group v-model="form.mode">
          <el-radio value="lcl">LCL 拼柜</el-radio>
          <el-radio value="fcl">FCL 整柜</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="form.mode === 'fcl'" label="柜数">
        <el-input-number v-model="form.containerCount" :min="1" />
      </el-form-item>
      <el-form-item label="金额 (RMB)" required>
        <el-input v-model="form.totalAmount" placeholder="海运/报关等费用" />
      </el-form-item>
      <el-form-item label="备注" class="span-two">
        <el-input v-model="form.remark" placeholder="可选备注" />
      </el-form-item>
      </div>
    </el-form>
    <div v-if="previewLines.length" class="sku-preview">
      <div class="sku-preview-title">
        <span>柜内 SKU 明细</span>
        <strong>合计 {{ formatArea(selectedContainer?.totalAreaCbm) }} m³</strong>
      </div>
      <el-table :data="previewLines" size="small" border>
        <el-table-column prop="sku" label="SKU" min-width="120">
          <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
        </el-table-column>
        <el-table-column prop="qty" label="数量" width="88" align="right" />
        <el-table-column label="分摊海运面积 (m³)" min-width="150" align="right">
          <template #default="{ row }">{{ formatArea(row.areaCbm) }}</template>
        </el-table-column>
      </el-table>
    </div>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitExpense">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="detailVisible" :title="detailRow ? `海运账单 · ${detailRow.id}` : '海运账单详情'" width="760px">
    <template v-if="detailRow">
      <div class="info-grid">
        <div><span>账单编号</span><strong class="mono">{{ detailRow.id }}</strong></div>
        <div><span>关联柜号</span><strong class="mono">{{ detailRow.containerNo || '—' }}</strong></div>
        <div><span>供应商</span><strong>{{ detailRow.supplier }}</strong></div>
        <div><span>金额</span><strong>¥ {{ detailRow.amount }}</strong></div>
        <div><span>运输方式</span><strong>{{ detailRow.mode }}</strong></div>
        <div><span>状态</span><strong>{{ detailRow.status }}</strong></div>
        <div><span>日期</span><strong>{{ detailRow.date }}</strong></div>
        <div><span>合计面积</span><strong>{{ formatArea(detailRow.totalAreaCbm) }} m³</strong></div>
      </div>
      <div class="sku-preview">
        <div class="sku-preview-title">
          <span>SKU 明细</span>
          <strong>{{ detailRow.skuLines.length }} 个 SKU</strong>
        </div>
        <el-table v-if="detailRow.skuLines.length" :data="detailRow.skuLines" size="small" border>
          <el-table-column prop="sku" label="SKU" min-width="120">
            <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
          </el-table-column>
          <el-table-column prop="productName" label="商品" min-width="140" show-overflow-tooltip />
          <el-table-column prop="qty" label="数量" width="88" align="right" />
          <el-table-column label="分摊海运面积 (m³)" min-width="150" align="right">
            <template #default="{ row }">{{ formatArea(row.areaCbm) }}</template>
          </el-table-column>
          <el-table-column label="占比" width="80" align="right">
            <template #default="{ row }">{{ row.areaCbm ? `${Number(row.sharePct || 0).toFixed(1)}%` : '—' }}</template>
          </el-table-column>
        </el-table>
        <p v-else class="empty-hint">该柜号暂无 SKU 明细。可在明瑞物流里补齐柜号货物后刷新。</p>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions, .embedded-toolbar { display:flex; gap:8px; align-items:center; }
.embedded-toolbar { justify-content:flex-end; margin-bottom:12px; }
.is-embedded { border: none; background: transparent; }
.page-subtitle { margin-top:4px; color:var(--text-muted); font-size:12px; }
.bill-summary {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:1px;
  overflow:hidden;
  margin-bottom:14px;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--border);
}
.bill-summary > div {
  min-height:70px;
  padding:12px 15px;
  background:var(--panel-solid);
}
.bill-summary span { display:block; margin-bottom:6px; color:var(--text-muted); font-size:11px; }
.bill-summary strong { color:var(--text); font-size:15px; font-variant-numeric:tabular-nums; }
.dialog-note {
  margin:0 0 16px;
  padding:10px 12px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--panel-soft);
  color:var(--text-secondary);
  font-size:12px;
}
.expense-form-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:0 16px;
}
.span-two { grid-column:1 / -1; }
.freight-table-scroll { --erp-table-min-width: 980px; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.linkish { color: #2563eb; }
.info-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:1px;
  overflow:hidden;
  margin-bottom:16px;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--border);
}
.info-grid > div {
  min-height:64px;
  padding:12px 14px;
  background:var(--panel-solid);
}
.info-grid span { display:block; margin-bottom:6px; color:var(--text-muted); font-size:11px; }
.info-grid strong { color:var(--text); font-size:13px; }
.sku-preview { margin-top:4px; }
.sku-preview-title {
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin:12px 0 8px;
  color:var(--text);
  font-size:13px;
  font-weight:600;
}
.sku-preview-title strong { color:var(--text-muted); font-size:12px; font-weight:500; }
.empty-hint { margin:0; color:var(--text-muted); font-size:12px; }
@media (max-width:680px) {
  .bill-summary,
  .expense-form-grid,
  .info-grid { grid-template-columns:1fr; }
  .span-two { grid-column:auto; }
}
</style>
