<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { operatingLedgerApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { pickFile } from '@/composables/useAsyncIo'

type LedgerRow = {
  id: number
  entryNo: string
  direction: 'income' | 'expense'
  category: string
  amount: number | string
  currency: string
  paymentMethod?: string | null
  accountName?: string | null
  counterparty?: string | null
  referenceNo?: string | null
  occurredOn: string
  remark?: string | null
}

const app = useAppStore()
const canManage = computed(() => app.hasPerm('operating_ledger.manage'))
const loading = ref(false)
const rows = ref<LedgerRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()

const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

const filters = reactive({
  dateRange: [monthStart, today] as string[],
  direction: '',
  category: '',
  currency: 'CNY',
  keyword: '',
})

const summary = reactive({ totalIncome: 0, totalExpense: 0, netAmount: 0, incomeCount: 0, expenseCount: 0 })
const form = reactive({
  direction: 'expense' as 'income' | 'expense',
  category: '',
  amount: null as number | null,
  currency: 'CNY',
  paymentMethod: '',
  accountName: '',
  counterparty: '',
  referenceNo: '',
  occurredOn: today,
  remark: '',
})

const expenseCategories = ['办公费', '房租物业', '水电通讯', '工资社保', '差旅交通', '业务招待', '广告推广', '软件服务', '银行手续费', '税费', '其他支出']
const incomeCategories = ['主营收入', '服务收入', '利息收入', '退款返还', '其他收入']
const categories = computed(() => form.direction === 'income' ? incomeCategories : expenseCategories)
const filterCategories = [...incomeCategories, ...expenseCategories]
const paymentMethods = ['银行转账', '现金', '支付宝', '微信', '公司卡', '其他']
const currencySymbol: Record<string, string> = { CNY: '¥', ZAR: 'R', USD: '$' }

const rules: FormRules = {
  direction: [{ required: true, message: '请选择收支类型', trigger: 'change' }],
  category: [{ required: true, message: '请选择或填写类别', trigger: 'change' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  occurredOn: [{ required: true, message: '请选择发生日期', trigger: 'change' }],
}

function money(value: unknown, currency = filters.currency || 'CNY') {
  const symbol = currencySymbol[currency] || currency
  return `${symbol} ${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function load() {
  loading.value = true
  try {
    const result = await operatingLedgerApi.list({
      page: page.value,
      pageSize: pageSize.value,
      startDate: filters.dateRange?.[0] || undefined,
      endDate: filters.dateRange?.[1] || undefined,
      direction: filters.direction || undefined,
      category: filters.category || undefined,
      currency: filters.currency || undefined,
      keyword: filters.keyword.trim() || undefined,
    })
    rows.value = result.items || []
    total.value = Number(result.total || 0)
    Object.assign(summary, result.summary || {})
  } finally {
    loading.value = false
  }
}

async function search() {
  page.value = 1
  await load()
}

async function resetFilters() {
  filters.dateRange = [monthStart, today]
  filters.direction = ''
  filters.category = ''
  filters.currency = 'CNY'
  filters.keyword = ''
  await search()
}

function resetForm() {
  editingId.value = null
  Object.assign(form, {
    direction: 'expense', category: '', amount: null, currency: filters.currency || 'CNY',
    paymentMethod: '', accountName: '', counterparty: '', referenceNo: '', occurredOn: today, remark: '',
  })
  formRef.value?.clearValidate()
}

function openCreate() {
  resetForm()
  dialogVisible.value = true
}

function openEdit(raw: any) {
  const row = raw as LedgerRow
  editingId.value = row.id
  Object.assign(form, {
    direction: row.direction,
    category: row.category,
    amount: Number(row.amount),
    currency: row.currency,
    paymentMethod: row.paymentMethod || '',
    accountName: row.accountName || '',
    counterparty: row.counterparty || '',
    referenceNo: row.referenceNo || '',
    occurredOn: String(row.occurredOn).slice(0, 10),
    remark: row.remark || '',
  })
  dialogVisible.value = true
}

async function submit() {
  if (!await formRef.value?.validate()) return
  const payload = { ...form, amount: Number(form.amount) }
  if (editingId.value) await operatingLedgerApi.update(editingId.value, payload)
  else await operatingLedgerApi.create(payload)
  ElMessage.success(editingId.value ? '收支记录已更新' : '收支记录已保存')
  dialogVisible.value = false
  await load()
}

async function remove(raw: any) {
  const row = raw as LedgerRow
  await ElMessageBox.confirm(`确认删除 ${row.entryNo}？`, '删除收支记录', { type: 'warning' })
  await operatingLedgerApi.remove(row.id)
  ElMessage.success('已删除')
  if (rows.value.length === 1 && page.value > 1) page.value -= 1
  await load()
}

function exportCsv() {
  const headers = ['流水号', '发生日期', '类型', '类别', '金额', '币种', '支付方式', '账户', '往来方', '关联单号', '备注']
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = rows.value.map((row) => [row.entryNo, String(row.occurredOn).slice(0, 10), row.direction === 'income' ? '收入' : '支出', row.category, row.amount, row.currency, row.paymentMethod, row.accountName, row.counterparty, row.referenceNo, row.remark].map(escape).join(','))
  const blob = new Blob([`\ufeff${headers.map(escape).join(',')}\n${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `经营收支_${filters.dateRange?.[0] || '全部'}_${filters.dateRange?.[1] || '全部'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function downloadTemplate() {
  const content = [
    '流水号,收支类型,类别,金额,币种,支付方式,收付款账户,往来方,关联单号,发生日期,备注',
    ',支出,办公费,120.50,CNY,银行转账,招商银行基本户,办公用品公司,FP-001,2026-08-21,购买办公用品',
    ',收入,服务收入,5000.00,CNY,银行转账,招商银行基本户,客户公司,HT-001,2026-08-21,服务费到账',
  ].join('\n')
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '经营收支导入模板.csv'
  link.click()
  URL.revokeObjectURL(url)
}

async function importCsv() {
  const file = await pickFile('.csv')
  if (!file) return
  loading.value = true
  try {
    const result = await operatingLedgerApi.importCsv({ fileName: file.name, content: await file.text() })
    const imported = Number(result.imported || 0)
    const failed = Number(result.failed || 0)
    if (failed) {
      const details = (result.errors || []).slice(0, 20).map((error: any) => `第 ${error.line} 行：${error.message}`).join('\n')
      await ElMessageBox.alert(`成功 ${imported} 条，失败 ${failed} 条。\n\n${details}${failed > 20 ? '\n……仅显示前 20 条' : ''}`, '导入结果', {
        confirmButtonText: '知道了',
        type: imported ? 'warning' : 'error',
      })
    } else {
      ElMessage.success(`导入完成：成功 ${imported} 条`)
    }
    await search()
  } catch (error: any) {
    ElMessage.error(error?.message || '导入失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <div>
          <div class="page-title">经营收支</div>
          <p class="page-subtitle">记录公司日常收入与开销，不关联商品、订单和库存</p>
        </div>
        <div class="header-actions">
          <el-button size="small" :disabled="!rows.length" @click="exportCsv">导出当前页</el-button>
          <el-button v-if="canManage" size="small" @click="downloadTemplate">下载导入模板</el-button>
          <el-button v-if="canManage" size="small" @click="importCsv">导入</el-button>
          <el-button v-if="canManage" type="primary" size="small" @click="openCreate">新增收支</el-button>
        </div>
      </div>
    </template>

    <div class="filters">
      <el-date-picker v-model="filters.dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width:260px" />
      <el-select v-model="filters.direction" clearable placeholder="全部类型" style="width:120px">
        <el-option label="收入" value="income" />
        <el-option label="支出" value="expense" />
      </el-select>
      <el-select v-model="filters.category" clearable filterable placeholder="全部类别" style="width:150px">
        <el-option v-for="item in filterCategories" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="filters.currency" clearable placeholder="全部币种" style="width:110px">
        <el-option label="人民币 CNY" value="CNY" />
        <el-option label="南非兰特 ZAR" value="ZAR" />
        <el-option label="美元 USD" value="USD" />
      </el-select>
      <el-input v-model="filters.keyword" clearable placeholder="流水号 / 往来方 / 备注" style="width:220px" @keyup.enter="search" />
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card income"><span>收入合计</span><strong>{{ money(summary.totalIncome) }}</strong><small>{{ summary.incomeCount }} 笔</small></div>
      <div class="kpi-card expense"><span>支出合计</span><strong>{{ money(summary.totalExpense) }}</strong><small>{{ summary.expenseCount }} 笔</small></div>
      <div class="kpi-card net" :class="summary.netAmount >= 0 ? 'positive' : 'negative'"><span>收支净额</span><strong>{{ money(summary.netAmount) }}</strong><small>收入 − 支出</small></div>
    </div>

    <div class="erp-table-scroll ledger-table-scroll">
      <el-table :data="rows" stripe border size="small">
        <el-table-column prop="entryNo" label="流水号" min-width="156" fixed="left" show-overflow-tooltip><template #default="{ row }"><span class="mono">{{ row.entryNo }}</span></template></el-table-column>
        <el-table-column prop="occurredOn" label="发生日期" width="110"><template #default="{ row }">{{ String(row.occurredOn).slice(0, 10) }}</template></el-table-column>
        <el-table-column prop="direction" label="类型" width="82"><template #default="{ row }"><el-tag :type="row.direction === 'income' ? 'success' : 'danger'" size="small">{{ row.direction === 'income' ? '收入' : '支出' }}</el-tag></template></el-table-column>
        <el-table-column prop="category" label="类别" width="120" show-overflow-tooltip />
        <el-table-column prop="amount" label="金额" width="132" align="right"><template #default="{ row }"><strong :class="row.direction === 'income' ? 'income-text' : 'expense-text'">{{ row.direction === 'income' ? '+' : '-' }}{{ money(row.amount, row.currency) }}</strong></template></el-table-column>
        <el-table-column prop="paymentMethod" label="支付方式" width="110"><template #default="{ row }">{{ row.paymentMethod || '—' }}</template></el-table-column>
        <el-table-column prop="accountName" label="收付款账户" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.accountName || '—' }}</template></el-table-column>
        <el-table-column prop="counterparty" label="往来方" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.counterparty || '—' }}</template></el-table-column>
        <el-table-column prop="referenceNo" label="关联单号" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ row.referenceNo || '—' }}</template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.remark || '—' }}</template></el-table-column>
        <el-table-column v-if="canManage" label="操作" width="112" fixed="right" align="center"><template #default="{ row }"><el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button><el-button link type="danger" size="small" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <div class="pagination-wrap"><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[20, 50, 100]" :total="total" layout="total, sizes, prev, pager, next, jumper" @current-change="load" @size-change="search" /></div>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editingId ? '编辑收支记录' : '新增收支记录'" width="680px" @closed="resetForm">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="92px">
      <div class="form-grid">
        <el-form-item label="收支类型" prop="direction"><el-radio-group v-model="form.direction" @change="form.category = ''"><el-radio-button value="income">收入</el-radio-button><el-radio-button value="expense">支出</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="发生日期" prop="occurredOn"><el-date-picker v-model="form.occurredOn" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="收支类别" prop="category"><el-select v-model="form.category" filterable allow-create default-first-option style="width:100%"><el-option v-for="item in categories" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="金额" prop="amount"><div class="amount-row"><el-select v-model="form.currency" style="width:92px"><el-option label="CNY" value="CNY" /><el-option label="ZAR" value="ZAR" /><el-option label="USD" value="USD" /></el-select><el-input-number v-model="form.amount" :min="0.01" :precision="2" :step="100" controls-position="right" style="flex:1" /></div></el-form-item>
        <el-form-item label="支付方式"><el-select v-model="form.paymentMethod" clearable allow-create filterable style="width:100%"><el-option v-for="item in paymentMethods" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="收付款账户"><el-input v-model="form.accountName" maxlength="100" placeholder="如：招商银行基本户" /></el-form-item>
        <el-form-item label="往来方"><el-input v-model="form.counterparty" maxlength="150" placeholder="付款人或收款单位" /></el-form-item>
        <el-form-item label="关联单号"><el-input v-model="form.referenceNo" maxlength="50" placeholder="发票号、报销单号等" /></el-form-item>
        <el-form-item label="备注" class="span-2"><el-input v-model="form.remark" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item>
      </div>
    </el-form>
    <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" @click="submit">保存</el-button></template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.page-title { font-size:15px; font-weight:600; }
.page-subtitle { margin:4px 0 0; color:var(--text-muted); font-size:12px; }
.header-actions, .filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.filters { margin-bottom:14px; }
.kpi-grid { display:grid; grid-template-columns:repeat(3, minmax(180px, 1fr)); gap:12px; margin-bottom:16px; }
.kpi-card { padding:16px 18px; border:1px solid var(--el-border-color-lighter); border-radius:8px; background:var(--el-fill-color-blank); }
.kpi-card span, .kpi-card small { display:block; color:var(--el-text-color-secondary); font-size:12px; }
.kpi-card strong { display:block; margin:8px 0 5px; font-size:24px; }
.kpi-card.income strong, .income-text, .kpi-card.positive strong { color:var(--el-color-success); }
.kpi-card.expense strong, .expense-text, .kpi-card.negative strong { color:var(--el-color-danger); }
.ledger-table-scroll { --erp-table-min-width: 1420px; }
.mono { font-family:var(--font-mono); font-size:12px; }
.pagination-wrap { display:flex; justify-content:flex-end; margin-top:14px; }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
.span-2 { grid-column:1 / -1; }
.amount-row { display:flex; gap:8px; width:100%; }
@media (max-width: 800px) { .kpi-grid, .form-grid { grid-template-columns:1fr; } .span-2 { grid-column:auto; } }
</style>
