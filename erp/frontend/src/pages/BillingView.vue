<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { billingApi, customerApi } from '@/api/client.js'
import { fmtTime, num } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { showDetail, exportTask, toast, confirmAction } = useRowActions()

const tab = ref<'charges' | 'customers'>('charges')
const searchQ = ref('')
const filterCustomer = ref<number | ''>('')
const filterSource = ref('all')
const filterType = ref('all')
const dateFrom = ref('')
const dateTo = ref('')

const generateVisible = ref(false)
const generatePreview = ref({ chargeCount: 0, totalAmount: 0, customerCount: 0 })
const chargeDialogVisible = ref(false)
const customers = ref<{ id: number; name: string }[]>([])

const chargeForm = ref({
  customerId: null as number | null,
  chargeType: 'relabel',
  amount: '',
  description: '',
  chargeDate: new Date().toISOString().slice(0, 10),
})

const CHARGE_TYPES = [
  { value: 'wms_outbound', label: 'WMS出库单（历史）' },
  { value: 'order_fee', label: '订单处理费' },
  { value: 'picking', label: '拣货费' },
  { value: 'storage', label: '仓储费' },
  { value: 'outbound_ship', label: '出库运费' },
  { value: 'relabel', label: '换标' },
  { value: 'repack', label: '换箱' },
  { value: 'handling', label: '手工作业' },
  { value: 'other', label: '其他工费' },
]

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  pending: { label: '待入账', tone: 'warn' },
  confirmed: { label: '已入账', tone: 'ok' },
  paid: { label: '已结清', tone: 'ok' },
}

function mapCharge(row: any) {
  const st = row.status === 'confirmed'
    ? { label: '已入账', tone: 'ok' }
    : { label: '待入账', tone: 'warn' }
  return {
    id: row.chargeNo,
    customer: row.customerName,
    type: row.chargeTypeLabel || row.chargeType,
    source: row.source === 'wms' ? 'WMS 推送' : row.source === 'erp' ? 'ERP 出库' : '手工录入',
    amount: num(row.amount).toLocaleString(),
    quantity: Number(row.quantity ?? 1),
    unitPrice: row.unitPrice != null ? num(row.unitPrice) : null,
    chargeTypeCode: row.chargeType || '',
    desc: row.description || '—',
    date: String(row.chargeDate).slice(0, 10),
    status: st.label,
    tone: st.tone,
    ref: row.bizRef || row.sourceRef || '—',
    bizRef: row.bizRef || '—',
    sourceRef: row.sourceRef || '—',
    _raw: row,
  }
}

function mapBill(row: any) {
  const st = STATUS_MAP[row.status] || { label: row.status, tone: 'info' }
  const typeLabels = (row.items || []).map((i: any) => i.itemType).slice(0, 2).join('、') || '汇总'
  return {
    id: row.billingNo,
    customer: row.customerName || `客户 #${row.customerId}`,
    type: typeLabels,
    amount: num(row.totalAmount).toLocaleString(),
    period: row.billingMonth,
    itemCount: row.items?.length ?? 0,
    status: st.label,
    tone: st.tone,
    time: fmtTime(row.createdAt).split(' ')[0],
    _raw: row,
  }
}

const chargeParams = computed(() => ({
  pageSize: 100,
  customerId: filterCustomer.value || undefined,
  source: filterSource.value === 'all' ? undefined : filterSource.value,
  chargeType: filterType.value === 'all' ? undefined : filterType.value,
  dateFrom: dateFrom.value || undefined,
  dateTo: dateTo.value || undefined,
  keyword: searchQ.value.trim() || undefined,
}))

const { loading: chargeLoading, items: rawCharges, load: loadCharges } = useListLoader(async () => {
  const res = await billingApi.listCharges(chargeParams.value)
  return { items: (res.items || []).map(mapCharge) }
})

const { loading: billLoading, items: rawBills, load: loadBills } = useListLoader(async () => {
  const res = await billingApi.list({ pageSize: 100, keyword: searchQ.value.trim() || undefined })
  return { items: (res.items || []).map(mapBill) }
})

const loading = computed(() => tab.value === 'charges' ? chargeLoading.value : billLoading.value)

const displayItems = computed(() => {
  const list = tab.value === 'charges' ? rawCharges.value : rawBills.value
  if (!searchQ.value || tab.value === 'charges') return list
  const q = searchQ.value.toLowerCase()
  return list.filter((c) => c.customer.toLowerCase().includes(q))
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(displayItems)
watch([tab, searchQ, filterCustomer, filterSource, filterType, dateFrom, dateTo], () => {
  resetPage()
  loadCurrent()
})

function loadCurrent() {
  if (tab.value === 'charges') loadCharges()
  else loadBills()
}

async function loadCustomers() {
  try {
    const res = await customerApi.list({ pageSize: 200 })
    customers.value = (res.items || []).map((c: any) => ({
      id: Number(c.id),
      name: c.customerName || c.customerCode,
    }))
  } catch {
    customers.value = []
  }
}

async function openGenerate() {
  try {
    generatePreview.value = await billingApi.previewGenerate({
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      customerId: filterCustomer.value || undefined,
    })
  } catch {
    generatePreview.value = { chargeCount: 0, totalAmount: 0, customerCount: 0 }
  }
  generateVisible.value = true
}

async function submitGenerate() {
  if (!generatePreview.value.chargeCount) {
    toast('当前时间范围内暂无待入账费用', 'warning')
    return
  }
  const ok = await withAction(async () => {
    const res = await billingApi.generate({
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      customerId: filterCustomer.value || undefined,
    })
    toast(`已生成 ${res.count} 张账单，共汇总 ${res.totalCharges} 笔费用`)
    tab.value = 'customers'
    await loadBills()
    await loadCharges()
  }, '账单已生成')
  if (ok) generateVisible.value = false
}

function openManualCharge() {
  chargeForm.value = {
    customerId: customers.value[0]?.id ?? null,
    chargeType: 'relabel',
    amount: '',
    description: '',
    chargeDate: new Date().toISOString().slice(0, 10),
  }
  chargeDialogVisible.value = true
}

async function submitManualCharge() {
  if (!chargeForm.value.customerId) {
    toast('请选择客户', 'warning')
    return
  }
  const amount = parseFloat(chargeForm.value.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('请填写有效金额', 'warning')
    return
  }
  const ok = await withAction(async () => {
    await billingApi.createCharge({
      customerId: chargeForm.value.customerId,
      chargeType: chargeForm.value.chargeType,
      amount,
      description: chargeForm.value.description,
      chargeDate: chargeForm.value.chargeDate,
      source: 'manual',
    })
    await loadCharges()
  }, '手工作业费已录入')
  if (ok) chargeDialogVisible.value = false
}

function resetFilters() {
  filterCustomer.value = ''
  filterSource.value = 'all'
  filterType.value = 'all'
  dateFrom.value = ''
  dateTo.value = ''
  searchQ.value = ''
}

function chargeDetail(row: any) {
  showDetail(`费用明细 · ${row.id}`, [
    ['费用编号', row.id], ['客户', row.customer], ['类型', row.type], ['来源', row.source],
    ['类型原码', row.chargeTypeCode || '—'], ['数量', row.quantity],
    ['单价 (RMB)', row.unitPrice != null ? `¥ ${row.unitPrice.toLocaleString()}` : '—'],
    ['金额 (RMB)', `¥ ${row.amount}`], ['扣费日期', row.date], ['状态', row.status],
    ['业务单号', row.bizRef], ['来源单号', row.sourceRef], ['说明', row.desc],
  ])
}

function billDetail(row: any) {
  const items = row._raw?.items || []
  const lines = items.map((i: any, idx: number) => [`明细 ${idx + 1}`, `${i.description || i.itemType} · ¥${num(i.amount).toLocaleString()}`])
  showDetail(`账单 · ${row.id}`, [
    ['账单号', row.id], ['客户', row.customer], ['账期', row.period],
    ['费用笔数', row.itemCount], ['合计 (RMB)', `¥ ${row.amount}`], ['状态', row.status], ['日期', row.time],
    ...lines,
  ])
}

async function confirmBill(row: any) {
  if (row._raw?.status !== 'pending') return
  if (!(await confirmAction(`确认账单 ${row.id} 并入账？`, '确认账单'))) return
  await withAction(async () => {
    await billingApi.confirm(row._raw.id)
    await loadBills()
  }, '账单已确认入账')
}

onMounted(async () => {
  await loadCustomers()
  await loadCharges()
  await loadBills()
})
</script>

<template>
  <div class="billing-page">
    <el-card v-loading="loading">
      <template #header>
        <div class="page-header">
          <span class="page-title">客户结算</span>
          <div class="header-actions">
            <el-input v-model="searchQ" placeholder="搜索客户" clearable style="width: 160px" size="small" />
            <el-button size="small" @click="openManualCharge">+ 手工作业费</el-button>
            <el-button type="primary" size="small" @click="openGenerate">生成账单</el-button>
            <el-button size="small" @click="exportTask('客户结算')">导出</el-button>
          </div>
        </div>
      </template>

      <div class="callout info">
        <div class="callout-title">客户结算 · {{ tab === 'charges' ? '逐笔费用明细' : '按客户汇总账单' }}</div>
        <div class="callout-body">
          <template v-if="tab === 'charges'">
            每笔扣费可追溯至 OMS/ERP 出库单、仓储周期或手工作业。OMS 下出库单时若有运费预扣会立即入账；未预扣的费用在仓库发运后入账。不选日期则显示全部。
          </template>
          <template v-else>
            账单由所选时间范围内的未入账费用按客户汇总生成，确认后标记为已入账。
          </template>
        </div>
      </div>

      <el-tabs v-model="tab" type="card">
        <el-tab-pane label="费用明细" name="charges" />
        <el-tab-pane label="客户维度" name="customers" />
      </el-tabs>

      <div v-if="tab === 'charges'" class="filter-bar">
        <el-select v-model="filterCustomer" placeholder="全部客户" clearable size="small" style="width: 140px">
          <el-option v-for="c in customers" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="filterSource" size="small" style="width: 110px">
          <el-option label="全部来源" value="all" />
          <el-option label="WMS 推送" value="wms" />
          <el-option label="ERP 出库" value="erp" />
          <el-option label="手工录入" value="manual" />
        </el-select>
        <el-select v-model="filterType" size="small" style="width: 120px">
          <el-option label="全部类型" value="all" />
          <el-option v-for="t in CHARGE_TYPES" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" size="small" clearable style="width: 130px" />
        <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" size="small" clearable style="width: 130px" />
        <el-button size="small" @click="resetFilters">重置</el-button>
      </div>

      <!-- 费用明细 -->
      <el-table v-if="tab === 'charges'" :data="pagedItems" stripe border size="small">
        <el-table-column prop="id" label="费用编号" min-width="170">
          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column prop="customer" label="客户" min-width="140" />
        <el-table-column prop="type" label="费用类型" width="100" />
        <el-table-column prop="source" label="来源" width="90" />
        <el-table-column prop="desc" label="说明" min-width="180" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="72" align="right" />
        <el-table-column label="单价 (RMB)" width="105" align="right">
          <template #default="{ row }">{{ row.unitPrice != null ? `¥ ${row.unitPrice.toLocaleString()}` : '—' }}</template>
        </el-table-column>
        <el-table-column prop="amount" label="金额 (RMB)" width="110" align="right">
          <template #default="{ row }">¥ {{ row.amount }}</template>
        </el-table-column>
        <el-table-column prop="date" label="扣费日期" width="100" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.tone === 'ok' ? 'success' : 'warning'" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="chargeDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty
        v-if="tab === 'charges' && !chargeLoading && !pagedItems.length"
        description="暂无费用。OMS 出库有预扣运费会立即出现；未预扣的请等仓库发运，或点「手工作业费」录入。"
        :image-size="64"
        style="margin-top:16px"
      />
      <el-table v-else :data="pagedItems" stripe border size="small">
        <el-table-column prop="id" label="账单号" width="160">
          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column prop="customer" label="客户" min-width="160" />
        <el-table-column prop="itemCount" label="费用笔数" width="90" align="center" />
        <el-table-column prop="amount" label="合计 (RMB)" width="120" align="right">
          <template #default="{ row }">¥ {{ row.amount }}</template>
        </el-table-column>
        <el-table-column prop="period" label="账期" width="100" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.tone === 'ok' ? 'success' : row.tone === 'warn' ? 'warning' : 'info'" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="time" label="生成日期" width="90" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="billDetail(row)">详情</el-button>
            <el-button v-if="row._raw?.status === 'pending'" link type="warning" size="small" @click="confirmBill(row)">确认</el-button>
          </template>
        </el-table-column>
      </el-table>

      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </el-card>

    <!-- 生成账单 -->
    <el-dialog v-model="generateVisible" title="生成账单" width="480px">
      <p style="font-weight:500;margin:0 0 12px">按当前筛选时间范围汇总未入账费用</p>
      <el-form label-width="100px">
        <el-form-item label="时间范围">
          <span>{{ dateFrom }} ~ {{ dateTo }}</span>
        </el-form-item>
        <el-form-item label="待入账笔数">
          <span>{{ generatePreview.chargeCount }} 笔</span>
        </el-form-item>
        <el-form-item label="涉及客户">
          <span>{{ generatePreview.customerCount }} 个</span>
        </el-form-item>
        <el-form-item label="待入账合计">
          <span class="mono" style="color:#dc2626;font-weight:600">¥ {{ generatePreview.totalAmount.toLocaleString() }} RMB</span>
        </el-form-item>
      </el-form>
      <p class="hint">含 ERP 出库自动计费、历史 WMS 推送及手工录入的换标、换箱等工费。生成后进入「客户维度」待确认状态。</p>
      <template #footer>
        <el-button @click="generateVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!generatePreview.chargeCount" @click="submitGenerate">确认生成</el-button>
      </template>
    </el-dialog>

    <!-- 手工作业费 -->
    <el-dialog v-model="chargeDialogVisible" title="手工作业费 · 换标 / 换箱等" width="460px">
      <el-form label-width="90px">
        <el-form-item label="客户" required>
          <el-select v-model="chargeForm.customerId" placeholder="选择客户" style="width:100%">
            <el-option v-for="c in customers" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="费用类型">
          <el-select v-model="chargeForm.chargeType" style="width:100%">
            <el-option v-for="t in CHARGE_TYPES.filter(t => ['relabel','repack','handling','inspection','other'].includes(t.value))" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="扣费日期">
          <el-date-picker v-model="chargeForm.chargeDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
        <el-form-item label="金额 (RMB)" required>
          <el-input v-model="chargeForm.amount" placeholder="扣费金额" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="chargeForm.description" type="textarea" :rows="2" placeholder="如：换标 × 500 件" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="chargeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitManualCharge">保存扣费</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-weight: 600; font-size: 15px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.hint { font-size: 12px; color: #8b95a8; margin: 0; }
.callout { border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; }
.callout.info { background: #f0f7ff; border: 1px solid #bfdbfe; }
.callout-title { font-weight: 600; margin-bottom: 4px; color: #1e40af; }
.callout-body { color: #475569; line-height: 1.5; }
</style>
