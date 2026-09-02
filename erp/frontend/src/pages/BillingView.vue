<script setup lang="ts">

import { ref, computed, onMounted, watch } from 'vue'

import { billingApi, customerApi } from '@/api/client.js'

import { fmtTime, num } from '@/api/mappers.ts'

import { useListLoader, withAction } from '@/composables/useListLoader.ts'

import { useTablePagination } from '@/composables/useTablePagination.ts'

import { useRowActions } from '@/composables/useRowActions'

import ListPagination from '@/components/ListPagination.vue'



const { showDetail, toast, confirmAction } = useRowActions()



const filterCustomerId = ref<number | ''>('')

const filterCustomerCode = ref('')

const filterSource = ref('all')

const filterType = ref('all')

const dateFrom = ref('')

const dateTo = ref('')



const generateVisible = ref(false)

const generatePreview = ref({ chargeCount: 0, totalAmount: 0, customerCount: 0 })

const chargeDialogVisible = ref(false)

const customers = ref<{ id: number; code: string; name: string; label: string }[]>([])



const generateForm = ref({

  customerId: null as number | null,

  customerCode: '',

  source: 'all',

  chargeType: 'all',

  dateFrom: '',

  dateTo: '',

})



const chargeForm = ref({

  customerId: null as number | null,

  chargeType: 'relabel',

  amount: '',

  description: '',

  chargeDate: new Date().toISOString().slice(0, 10),

})



const CHARGE_TYPES = [

  { value: 'catalog_purchase', label: '货盘采购' },

  { value: 'order_fee', label: '订单处理费' },

  { value: 'picking', label: '拣货费' },

  { value: 'outbound_ship', label: '出库运费' },

  { value: 'shipping', label: '物流费' },

  { value: 'relabel', label: '换标' },

  { value: 'repack', label: '换箱' },

  { value: 'handling', label: '手工作业' },

  { value: 'storage', label: '仓储费' },

  { value: 'inspection', label: '质检' },

  { value: 'inbound_qc', label: '入库清点费' },

  { value: 'inbound_measure', label: '入库测量费' },

  { value: 'inbound_label', label: '入库贴标费' },

  { value: 'inbound_putaway', label: '入库上架费' },

  { value: 'return_logistics', label: '退件物流费' },

  { value: 'return_handling', label: '退件操作费' },

  { value: 'other', label: '其他工费' },

  { value: 'wms_outbound', label: 'WMS出库单（历史）' },

]



const SOURCE_OPTIONS = [

  { value: 'all', label: '全部来源' },

  { value: 'erp', label: 'ERP 出库' },

  { value: 'manual', label: '手工录入' },

]



const STATUS_MAP: Record<string, { label: string; tone: string }> = {

  pending: { label: '待入账', tone: 'warn' },

  confirmed: { label: '已入账', tone: 'ok' },

  paid: { label: '已结清', tone: 'ok' },

}



function mapSource(source?: string) {

  if (source === 'manual') return '手工录入'

  if (source === 'erp' || source === 'wms') return 'ERP 出库'

  return source || '—'

}



function mapCharge(row: any) {

  const st = row.status === 'confirmed'

    ? { label: '已入账', tone: 'ok' }

    : { label: '待入账', tone: 'warn' }

  return {

    rowKey: row.id,

    id: row.chargeNo,

    customer: row.customerName,

    customerCode: row.customerCode || '—',

    type: row.chargeTypeLabel || row.chargeType,

    source: mapSource(row.source),

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

  pageSize: 200,

  customerId: filterCustomerId.value || undefined,

  customerCode: filterCustomerCode.value.trim() || undefined,

  source: filterSource.value === 'all' ? undefined : filterSource.value,

  chargeType: filterType.value === 'all' ? undefined : filterType.value,

  dateFrom: dateFrom.value || undefined,

  dateTo: dateTo.value || undefined,

}))



const { loading: chargeLoading, items: rawCharges, load: loadCharges } = useListLoader(async () => {

  const res = await billingApi.listCharges(chargeParams.value)

  return { items: (res.items || []).map(mapCharge) }

})



const { loading: billLoading, items: rawBills, load: loadBills } = useListLoader(async () => {

  const res = await billingApi.list({ pageSize: 100 })

  return { items: (res.items || []).map(mapBill) }

})



const tableRef = ref()

const selectedRows = ref<any[]>([])



const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(rawCharges)

watch([filterCustomerId, filterCustomerCode, filterSource, filterType, dateFrom, dateTo], () => {

  resetPage()

  selectedRows.value = []

  tableRef.value?.clearSelection?.()

  loadCharges()

})



function onCustomerSelect(id: number | '') {

  filterCustomerId.value = id

  if (id) {

    const hit = customers.value.find(c => c.id === id)

    filterCustomerCode.value = hit?.code || ''

  }

}



function onCustomerCodeInput(code: string) {

  filterCustomerCode.value = code.trim().toUpperCase()

  const hit = customers.value.find(c => c.code.toUpperCase() === filterCustomerCode.value)

  filterCustomerId.value = hit?.id ?? ''

}



function onSelectionChange(rows: any[]) {

  selectedRows.value = rows

}



function clearSelection() {
  tableRef.value?.clearSelection?.()
  selectedRows.value = []
}



async function loadCustomers() {

  try {

    const res = await customerApi.list({ pageSize: 500 })

    customers.value = (res.items || []).map((c: any) => ({

      id: Number(c.id),

      code: c.customerCode || '',

      name: c.customerName || c.customerCode,

      label: `${c.customerCode || '—'} · ${c.customerName || ''}`,

    }))

  } catch {

    customers.value = []

  }

}



function buildGeneratePayload(form = generateForm.value) {

  return {

    dateFrom: form.dateFrom || undefined,

    dateTo: form.dateTo || undefined,

    customerId: form.customerId || undefined,

    customerCode: form.customerCode.trim() || undefined,

    source: form.source === 'all' ? undefined : form.source,

    chargeType: form.chargeType === 'all' ? undefined : form.chargeType,

  }

}



async function refreshGeneratePreview() {

  try {

    generatePreview.value = await billingApi.previewGenerate(buildGeneratePayload())

  } catch {

    generatePreview.value = { chargeCount: 0, totalAmount: 0, customerCount: 0 }

  }

}



async function openGenerate() {

  generateForm.value = {

    customerId: filterCustomerId.value ? Number(filterCustomerId.value) : null,

    customerCode: filterCustomerCode.value,

    source: filterSource.value,

    chargeType: filterType.value,

    dateFrom: dateFrom.value,

    dateTo: dateTo.value,

  }

  await refreshGeneratePreview()

  generateVisible.value = true

}



watch(generateForm, () => { void refreshGeneratePreview() }, { deep: true })



async function submitGenerate() {

  if (!generatePreview.value.chargeCount) {

    toast('当前筛选条件下暂无待入账费用', 'warning')

    return

  }

  const ok = await withAction(async () => {

    const res = await billingApi.generate(buildGeneratePayload())

    toast(`已生成 ${res.count} 张账单，共汇总 ${res.totalCharges} 笔费用`)

    await loadBills()

    await loadCharges()

  }, '账单已生成')

  if (ok) generateVisible.value = false

}



function openManualCharge() {

  chargeForm.value = {

    customerId: filterCustomerId.value ? Number(filterCustomerId.value) : (customers.value[0]?.id ?? null),

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

  filterCustomerId.value = ''

  filterCustomerCode.value = ''

  filterSource.value = 'all'

  filterType.value = 'all'

  dateFrom.value = ''

  dateTo.value = ''

}



function chargeDetail(row: any) {

  showDetail(`费用明细 · ${row.id}`, [

    ['费用编号', row.id], ['客户', row.customer], ['客户代码', row.customerCode], ['类型', row.type], ['来源', row.source],

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



function exportCharges(rows = selectedRows.value) {

  const list = rows.length ? rows : rawCharges.value

  if (!list.length) {

    toast('请先勾选要导出的费用，或确保列表有数据', 'warning')

    return

  }

  const headers = ['费用编号', '客户代码', '客户', '费用类型', '来源', '说明', '数量', '单价', '金额', '扣费日期', '状态', '业务单号']

  const lines = list.map(r => [

    r.id, r.customerCode, r.customer, r.type, r.source, r.desc,

    r.quantity, r.unitPrice ?? '', r.amount.replace(/,/g, ''), r.date, r.status, r.bizRef,

  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))

  const csv = '\ufeff' + [headers.join(','), ...lines].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })

  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')

  a.href = url

  a.download = `客户结算费用_${new Date().toISOString().slice(0, 10)}.csv`

  a.click()

  URL.revokeObjectURL(url)

  toast(`已导出 ${list.length} 笔费用`)

}



onMounted(async () => {

  await loadCustomers()

  await loadCharges()

  await loadBills()

})

</script>



<template>

  <div class="billing-page">

    <el-card v-loading="chargeLoading">

      <template #header>

        <div class="page-header">

          <span class="page-title">客户结算</span>

          <div class="header-actions">

            <el-button size="small" @click="openManualCharge">+ 手工作业费</el-button>

            <el-button type="primary" size="small" @click="openGenerate">生成账单</el-button>

            <el-button size="small" :disabled="!selectedRows.length" @click="exportCharges()">导出选中</el-button>

            <el-button size="small" @click="exportCharges(rawCharges)">导出全部</el-button>

          </div>

        </div>

      </template>



      <div class="callout info">

        <div class="callout-title">费用明细</div>

        <div class="callout-body">

          每笔扣费可追溯至 ERP 出库单或手工录入。生成账单时可按客户、来源、时间与类型筛选待入账费用。

        </div>

      </div>



      <div class="filter-bar">

        <el-select

          :model-value="filterCustomerId"

          placeholder="选择客户"

          clearable

          filterable

          size="small"

          style="width: 200px"

          @update:model-value="onCustomerSelect"

        >

          <el-option v-for="c in customers" :key="c.id" :label="c.label" :value="c.id" />

        </el-select>

        <el-input

          :model-value="filterCustomerCode"

          placeholder="输入客户代码"

          clearable

          size="small"

          style="width: 130px"

          @update:model-value="onCustomerCodeInput"

        />

        <el-select v-model="filterSource" size="small" style="width: 120px">

          <el-option v-for="s in SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />

        </el-select>

        <el-select v-model="filterType" size="small" style="width: 130px">

          <el-option label="全部类型" value="all" />

          <el-option v-for="t in CHARGE_TYPES" :key="t.value" :label="t.label" :value="t.value" />

        </el-select>

        <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" size="small" clearable style="width: 130px" />

        <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" size="small" clearable style="width: 130px" />

        <el-button size="small" @click="resetFilters">重置</el-button>

        <span v-if="selectedRows.length" class="sel-count">已选 {{ selectedRows.length }} 笔</span>

        <el-button v-if="selectedRows.length" size="small" link type="primary" @click="clearSelection">取消选择</el-button>

      </div>



      <el-table

        ref="tableRef"

        :data="pagedItems"

        :row-key="(row) => row.rowKey"

        stripe

        border

        size="small"

        @selection-change="onSelectionChange"

      >

        <el-table-column type="selection" width="42" fixed="left" reserve-selection />

        <el-table-column prop="id" label="费用编号" min-width="170">

          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>

        </el-table-column>

        <el-table-column prop="customerCode" label="客户代码" width="100">

          <template #default="{ row }"><span class="mono">{{ row.customerCode }}</span></template>

        </el-table-column>

        <el-table-column prop="customer" label="客户" min-width="120" show-overflow-tooltip />

        <el-table-column prop="type" label="费用类型" width="100" />

        <el-table-column prop="source" label="来源" width="90" />

        <el-table-column prop="desc" label="说明" min-width="160" show-overflow-tooltip />

        <el-table-column prop="quantity" label="数量" width="68" align="right" />

        <el-table-column label="单价" width="96" align="right">

          <template #default="{ row }">{{ row.unitPrice != null ? `¥ ${row.unitPrice.toLocaleString()}` : '—' }}</template>

        </el-table-column>

        <el-table-column prop="amount" label="金额" width="100" align="right">

          <template #default="{ row }">¥ {{ row.amount }}</template>

        </el-table-column>

        <el-table-column prop="date" label="扣费日期" width="100" />

        <el-table-column prop="status" label="状态" width="82">

          <template #default="{ row }">

            <el-tag :type="row.tone === 'ok' ? 'success' : 'warning'" size="small">{{ row.status }}</el-tag>

          </template>

        </el-table-column>

        <el-table-column label="操作" width="72" fixed="right">

          <template #default="{ row }">

            <el-button link type="primary" size="small" @click="chargeDetail(row)">详情</el-button>

          </template>

        </el-table-column>

      </el-table>

      <el-empty v-if="!chargeLoading && !pagedItems.length" description="暂无费用记录" :image-size="64" style="margin-top:16px" />

      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />

    </el-card>



    <el-card v-loading="billLoading" class="bill-card">

      <template #header>

        <span class="page-title">已生成账单</span>

      </template>

      <el-table :data="rawBills" stripe border size="small">

        <el-table-column prop="id" label="账单号" width="160">

          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>

        </el-table-column>

        <el-table-column prop="customer" label="客户" min-width="140" />

        <el-table-column prop="itemCount" label="费用笔数" width="88" align="center" />

        <el-table-column prop="amount" label="合计 (RMB)" width="120" align="right">

          <template #default="{ row }">¥ {{ row.amount }}</template>

        </el-table-column>

        <el-table-column prop="period" label="账期" width="96" />

        <el-table-column prop="status" label="状态" width="88">

          <template #default="{ row }">

            <el-tag :type="row.tone === 'ok' ? 'success' : row.tone === 'warn' ? 'warning' : 'info'" size="small">{{ row.status }}</el-tag>

          </template>

        </el-table-column>

        <el-table-column prop="time" label="生成日期" width="96" />

        <el-table-column label="操作" width="120" fixed="right">

          <template #default="{ row }">

            <el-button link type="primary" size="small" @click="billDetail(row)">详情</el-button>

            <el-button v-if="row._raw?.status === 'pending'" link type="warning" size="small" @click="confirmBill(row)">确认</el-button>

          </template>

        </el-table-column>

      </el-table>

      <el-empty v-if="!billLoading && !rawBills.length" description="暂无账单，可通过「生成账单」汇总待入账费用" :image-size="56" />

    </el-card>



    <el-dialog v-model="generateVisible" title="生成账单" width="520px">

      <p class="dialog-lead">按筛选条件汇总<strong>待入账</strong>费用，按客户分别生成账单。</p>

      <el-form label-width="88px" size="small">

        <el-form-item label="客户">

          <div class="inline-pair">

            <el-select v-model="generateForm.customerId" placeholder="选择客户" clearable filterable style="flex:1">

              <el-option v-for="c in customers" :key="c.id" :label="c.label" :value="c.id" />

            </el-select>

            <el-input v-model="generateForm.customerCode" placeholder="客户代码" clearable style="width:120px" />

          </div>

        </el-form-item>

        <el-form-item label="来源">

          <el-select v-model="generateForm.source" style="width:100%">

            <el-option v-for="s in SOURCE_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />

          </el-select>

        </el-form-item>

        <el-form-item label="费用类型">

          <el-select v-model="generateForm.chargeType" style="width:100%">

            <el-option label="全部类型" value="all" />

            <el-option v-for="t in CHARGE_TYPES" :key="t.value" :label="t.label" :value="t.value" />

          </el-select>

        </el-form-item>

        <el-form-item label="时间范围">

          <div class="inline-pair">

            <el-date-picker v-model="generateForm.dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="flex:1" />

            <span class="range-sep">~</span>

            <el-date-picker v-model="generateForm.dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="flex:1" />

          </div>

        </el-form-item>

        <el-divider />

        <el-form-item label="待入账笔数">{{ generatePreview.chargeCount }} 笔</el-form-item>

        <el-form-item label="涉及客户">{{ generatePreview.customerCount }} 个</el-form-item>

        <el-form-item label="待入账合计">

          <span class="amount-highlight">¥ {{ generatePreview.totalAmount.toLocaleString() }} RMB</span>

        </el-form-item>

      </el-form>

      <template #footer>

        <el-button @click="generateVisible = false">取消</el-button>

        <el-button type="primary" :disabled="!generatePreview.chargeCount" @click="submitGenerate">确认生成</el-button>

      </template>

    </el-dialog>



    <el-dialog v-model="chargeDialogVisible" title="手工作业费" width="460px">

      <el-form label-width="90px">

        <el-form-item label="客户" required>

          <el-select v-model="chargeForm.customerId" placeholder="选择客户" filterable style="width:100%">

            <el-option v-for="c in customers" :key="c.id" :label="c.label" :value="c.id" />

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

.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }

.page-title { font-weight: 600; font-size: 15px; }

.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }

.mono { font-family: var(--font-mono); font-size: 12px; }

.sel-count { font-size: 12px; color: #64748b; }

.callout { border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; }

.callout.info { background: #f0f7ff; border: 1px solid #bfdbfe; }

.callout-title { font-weight: 600; margin-bottom: 4px; color: #1e40af; }

.callout-body { color: #475569; line-height: 1.5; }

.bill-card { margin-top: 16px; }

.dialog-lead { margin: 0 0 16px; font-size: 13px; color: #475569; line-height: 1.5; }

.inline-pair { display: flex; align-items: center; gap: 8px; width: 100%; }

.range-sep { color: #94a3b8; flex-shrink: 0; }

.amount-highlight { font-family: var(--font-mono); color: #dc2626; font-weight: 600; }

</style>
