<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { freightBillApi, supplierApi } from '@/api/client.js'
import { fmtTime, num } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { showDetail, exportTask, toast } = useRowActions()

const dialogVisible = ref(false)
const suppliers = ref<any[]>([])
const form = ref({
  supplierId: null as number | null,
  totalAmount: '',
  billMonth: '',
  containerCount: 0,
  remark: '',
  mode: 'lcl' as 'lcl' | 'fcl',
})

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  confirmed: { label: '已入账', tone: 'ok' },
  draft: { label: '待入账', tone: 'info' },
  pending: { label: '待确认', tone: 'warn' },
}

function mapFreight(row: any) {
  const st = STATUS_MAP[row.status] || { label: row.status, tone: 'info' }
  return {
    id: row.billNo,
    supplier: row.supplierName || `供应商 #${row.supplierId}`,
    po: row.poNo || row.remark || '',
    type: row.source === 'finance_approve' ? '采购成本' : '海运费',
    amount: num(row.totalAmount).toLocaleString(),
    mode: row.containerCount ? 'FCL' : 'LCL',
    status: st.label,
    tone: st.tone,
    date: fmtTime(row.createdAt).split(' ')[0],
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

function addExpense() {
  const now = new Date()
  form.value = {
    supplierId: suppliers.value[0]?.id ?? null,
    totalAmount: '',
    billMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    containerCount: 0,
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
      remark: form.value.remark || undefined,
      status: 'draft',
    })
    await load()
  }, '海运费用已录入')
  if (ok) dialogVisible.value = false
}

function detail(row: any) {
  showDetail(`海运账单 · ${row.id}`, [
    ['账单编号', row.id], ['供应商', row.supplier], ['关联PO', row.po], ['费用类型', row.type],
    ['金额 (RMB)', `¥ ${row.amount}`], ['运输方式', row.mode], ['状态', row.status], ['日期', row.date],
  ])
}

onMounted(async () => {
  await loadSuppliers()
  await load()
})
</script>

<template>
  <el-card v-loading="loading" class="freight-page-card">
    <template #header>
      <div class="page-header">
        <div>
          <div class="page-title">供应商海运账单</div>
          <p class="page-subtitle">记录供应商海运、拼柜与整柜费用</p>
        </div>
        <div class="header-actions">
          <el-button type="primary" size="small" @click="addExpense">录入费用</el-button>
          <el-button size="small" @click="exportTask('海运账单')">导出</el-button>
        </div>
      </div>
    </template>
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
    <el-table :data="pagedItems" stripe border size="small" class="freight-table">
      <el-table-column prop="id" label="账单编号" width="140">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="supplier" label="供应商" min-width="140" />
      <el-table-column prop="po" label="关联PO" width="150">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px;color:#2563eb">{{ row.po }}</span></template>
      </el-table-column>
      <el-table-column prop="type" label="费用类型" width="90" />
      <el-table-column prop="amount" label="金额 (RMB)" width="120" align="right">
        <template #default="{ row }">¥ {{ row.amount }}</template>
      </el-table-column>
      <el-table-column prop="mode" label="运输方式" width="80" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="(row.tone as any)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="date" label="日期" width="80" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }"><el-button link type="primary" size="small" @click="detail(row)">详情</el-button></template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>

  <el-dialog v-model="dialogVisible" title="录入海运费用" width="640px" class="freight-entry-dialog">
    <p class="dialog-note">录入后将生成待入账的供应商海运账单，可在财务确认后进入成本核算。</p>
    <el-form label-position="top">
      <div class="expense-form-grid">
      <el-form-item label="供应商" required class="span-two">
        <el-select v-model="form.supplierId" placeholder="选择供应商" style="width:100%">
          <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
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
      <el-form-item label="关联 PO / 备注" class="span-two">
        <el-input v-model="form.remark" placeholder="PO 号或备注" />
      </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitExpense">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; align-items:center; }
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
@media (max-width:680px) {
  .bill-summary,
  .expense-form-grid { grid-template-columns:1fr; }
  .span-two { grid-column:auto; }
}
</style>
