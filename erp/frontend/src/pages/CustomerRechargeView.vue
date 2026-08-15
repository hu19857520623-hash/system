<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { customerApi } from '@/api/client.js'
import { mapCustomer, fmtTime } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { exportTask, toast } = useRowActions()

const keyword = ref('')

function toCustomerRow(row: any) {
  const m = mapCustomer(row)
  const totalRecharge = m.totalRecharge ?? num(row.totalRecharge)
  return {
    id: m.code,
    name: m.company,
    contact: m.contact,
    phone: m.phone,
    balance: m.balance,
    totalRecharge,
    totalConsumed: Math.max(0, totalRecharge - m.balance),
    status: m.status,
    lastRechargeAt: m.lastRechargeAt || fmtTime(row.lastRechargeAt).split(' ')[0] || '—',
    _id: row.id ?? m.id,
    _raw: row,
  }
}

function num(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function genRechargeNo() {
  const ds = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `RC-${ds}-${String(Date.now()).slice(-6)}`
}

const { loading, items: customers, load } = useListLoader(async () => {
  const params: any = { pageSize: 100 }
  if (keyword.value.trim()) params.keyword = keyword.value.trim()
  const res = await customerApi.list(params)
  return { items: (res.items || []).map(toCustomerRow), total: res.total }
})

const { page, pageSize, total, pagedItems } = useTablePagination(customers)

const dialogVisible = ref(false)
const rechargeForm = ref({
  customerId: null as number | null,
  customerCode: '',
  customerName: '',
  rechargeNo: '',
  amount: 1000,
  remark: '',
})

const detailVisible = ref(false)
const detailCustomer = ref<any>(null)
const detailHistory = ref<any[]>([])
const detailLoading = ref(false)

function resetRechargeForm(row?: any) {
  rechargeForm.value = {
    customerId: row?._id ?? null,
    customerCode: row?.id ?? '',
    customerName: row?.name ?? '',
    rechargeNo: genRechargeNo(),
    amount: 1000,
    remark: '',
  }
}

function openRecharge(row?: any) {
  resetRechargeForm(row)
  dialogVisible.value = true
}

function syncFromCustomer(row: { _id: number; id: string; name: string }) {
  rechargeForm.value.customerId = row._id
  rechargeForm.value.customerCode = row.id
  rechargeForm.value.customerName = row.name
}

async function onCodeBlur() {
  const code = rechargeForm.value.customerCode.trim()
  if (!code) {
    rechargeForm.value.customerId = null
    return
  }
  const local = customers.value.find((c) => c.id.toLowerCase() === code.toLowerCase())
  if (local) {
    syncFromCustomer(local)
    return
  }
  try {
    const res = await customerApi.list({ keyword: code, pageSize: 20 })
    const items = (res.items || []).map(toCustomerRow)
    const exact = items.find((c: any) => c.id.toLowerCase() === code.toLowerCase()) || items[0]
    if (exact) syncFromCustomer(exact)
    else {
      rechargeForm.value.customerId = null
      toast('未找到该客户 ID', 'warning')
    }
  } catch {
    rechargeForm.value.customerId = null
  }
}

async function queryCustomerSuggestions(queryString: string, cb: (rows: any[]) => void) {
  const q = queryString.trim()
  if (!q) {
    cb(customers.value.slice(0, 20).map((c) => ({ value: c.name, ...c })))
    return
  }
  try {
    const res = await customerApi.list({ keyword: q, pageSize: 20 })
    const items = (res.items || []).map(toCustomerRow)
    cb(items.map((c: any) => ({ value: c.name, ...c })))
  } catch {
    cb([])
  }
}

function onNameSelect(item: any) {
  syncFromCustomer(item)
}

function onNameBlur() {
  const name = rechargeForm.value.customerName.trim()
  if (!name) {
    rechargeForm.value.customerId = null
    return
  }
  const local = customers.value.find((c) => c.name === name)
  if (local) {
    syncFromCustomer(local)
    return
  }
  customerApi.list({ keyword: name, pageSize: 20 }).then((res) => {
    const items = (res.items || []).map(toCustomerRow)
    const exact = items.find((c: any) => c.name === name) || items[0]
    if (exact) syncFromCustomer(exact)
  }).catch(() => {})
}

async function submitRecharge() {
  if (!rechargeForm.value.customerId) {
    toast('请填写有效的客户 ID 或名称', 'warning')
    return
  }
  if (!rechargeForm.value.rechargeNo.trim()) {
    toast('请填写充值单号', 'warning')
    return
  }
  if (!rechargeForm.value.amount || rechargeForm.value.amount <= 0) {
    toast('请填写充值金额', 'warning')
    return
  }
  const rechargeNo = rechargeForm.value.rechargeNo.trim()
  const ok = await withAction(async () => {
    const res = await customerApi.recharge(rechargeForm.value.customerId!, {
      amount: rechargeForm.value.amount,
      rechargeNo,
      remark: rechargeForm.value.remark,
    })
    await load()
    return res
  }, `充值成功 · 单号 ${rechargeNo}`)
  if (ok) dialogVisible.value = false
}

async function showDetail(row: any) {
  detailCustomer.value = row
  detailVisible.value = true
  detailLoading.value = true
  try {
    detailHistory.value = await customerApi.rechargeHistory(row._id)
  } catch {
    detailHistory.value = []
  } finally {
    detailLoading.value = false
  }
}

function search() {
  load()
}

function resetSearch() {
  keyword.value = ''
  load()
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">客户充值</span>
        <div class="header-actions">
          <el-button type="primary" size="small" @click="openRecharge()">充值</el-button>
          <el-button size="small" @click="exportTask('客户充值')">导出</el-button>
        </div>
      </div>
    </template>

    <div class="filter-bar">
      <el-input
        v-model="keyword"
        placeholder="模糊搜索：客户 ID / 名称 / 联系人 / 电话"
        clearable
        style="width:320px"
        size="small"
        @keyup.enter="search"
      />
      <el-button size="small" @click="search">查询</el-button>
      <el-button size="small" @click="resetSearch">重置</el-button>
    </div>

    <el-table :data="pagedItems" stripe border size="small">
      <el-table-column prop="id" label="客户ID" width="100">
        <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="客户名称" min-width="180" />
      <el-table-column prop="contact" label="联系人" width="90" />
      <el-table-column prop="balance" label="余额 (RMB)" width="120" align="right">
        <template #default="{ row }">
          <span :class="{ low: row.balance < 5000 }">¥ {{ row.balance.toLocaleString() }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="totalRecharge" label="累计充值" width="110" align="right">
        <template #default="{ row }">¥ {{ row.totalRecharge.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="totalConsumed" label="累计消费" width="110" align="right">
        <template #default="{ row }">¥ {{ row.totalConsumed.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === '正常' ? 'success' : 'info'" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="lastRechargeAt" label="最近充值" width="100" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openRecharge(row)">充值</el-button>
          <el-button link type="primary" size="small" @click="showDetail(row)">明细</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !customers.length" description="暂无客户，请调整搜索条件" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>

  <el-dialog v-model="dialogVisible" title="客户充值" width="520px">
    <el-form label-width="90px" size="small">
      <el-form-item label="客户 ID" required>
        <el-input
          v-model="rechargeForm.customerCode"
          placeholder="输入客户 ID，如 CUS-001"
          @blur="onCodeBlur"
        />
      </el-form-item>
      <el-form-item label="客户名称" required>
        <el-autocomplete
          v-model="rechargeForm.customerName"
          :fetch-suggestions="queryCustomerSuggestions"
          placeholder="输入名称模糊搜索"
          style="width:100%"
          :trigger-on-focus="true"
          @select="onNameSelect"
          @blur="onNameBlur"
        />
      </el-form-item>
      <el-form-item label="充值单号" required>
        <el-input v-model="rechargeForm.rechargeNo" placeholder="每笔充值唯一单号">
          <template #append>
            <el-button @click="rechargeForm.rechargeNo = genRechargeNo()">生成</el-button>
          </template>
        </el-input>
      </el-form-item>
      <el-form-item label="充值金额" required>
        <el-input-number v-model="rechargeForm.amount" :min="0.01" :step="1000" style="width:100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="rechargeForm.remark" type="textarea" placeholder="备注信息" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitRecharge">确认充值</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="detailVisible"
    :title="`充值明细 · ${detailCustomer?.name || ''}`"
    width="640px"
  >
    <div v-if="detailCustomer" class="detail-summary">
      <span>客户 ID：<strong class="mono">{{ detailCustomer.id }}</strong></span>
      <span>当前余额：<strong>¥ {{ detailCustomer.balance.toLocaleString() }}</strong></span>
      <span>累计充值：<strong>¥ {{ detailCustomer.totalRecharge.toLocaleString() }}</strong></span>
    </div>
    <el-table v-loading="detailLoading" :data="detailHistory" border size="small" max-height="360">
      <el-table-column prop="rechargeNo" label="充值单号" width="160">
        <template #default="{ row }"><span class="mono">{{ row.rechargeNo }}</span></template>
      </el-table-column>
      <el-table-column prop="amount" label="金额" width="100" align="right">
        <template #default="{ row }">¥ {{ Number(row.amount).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'confirmed' ? 'success' : 'info'" size="small">
            {{ row.status === 'confirmed' ? '已确认' : row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!detailLoading && !detailHistory.length" description="暂无充值记录" :image-size="64" />
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; align-items:center; }
.filter-bar { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; align-items:center; }
.mono { font-family:var(--font-mono,Consolas,monospace); font-size:12px; }
.low { color:#f07178; font-weight:600; }
.detail-summary { display:flex; flex-wrap:wrap; gap:16px; margin-bottom:12px; font-size:13px; color:#555; }
</style>
