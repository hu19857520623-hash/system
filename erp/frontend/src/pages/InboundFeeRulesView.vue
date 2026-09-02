<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { inboundFeeApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
const canManage = computed(() => app.hasPerm('inbound_fee.manage') || app.authenticatedUser?.roleCode === 'admin')
const loading = ref(false)
const rows = ref<any[]>([])
const warehouses = ref<any[]>([])
const customers = ref<any[]>([])
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({
  ruleName: '',
  customerId: null as number | null,
  warehouseCode: '',
  qcUnitPrice: 0,
  measureUnitPrice: 0,
  labelUnitPrice: 0,
  putawayUnitPrice: 0,
  receiveUnitPrice: 0,
  receiveCartonPrice: 0,
  enabled: true,
  effectiveFrom: '',
  effectiveTo: '',
})

function resetForm() {
  form.ruleName = ''
  form.customerId = null
  form.warehouseCode = ''
  form.qcUnitPrice = 0
  form.measureUnitPrice = 0
  form.labelUnitPrice = 0
  form.putawayUnitPrice = 0
  form.receiveUnitPrice = 0
  form.receiveCartonPrice = 0
  form.enabled = true
  form.effectiveFrom = ''
  form.effectiveTo = ''
}

async function load() {
  loading.value = true
  try {
    const [list, options] = await Promise.all([
      inboundFeeApi.list(),
      inboundFeeApi.options(),
    ])
    rows.value = Array.isArray(list) ? list : list.items || []
    customers.value = options.customers || []
    warehouses.value = options.warehouses || []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEdit(row: any) {
  editingId.value = row.id
  form.ruleName = row.ruleName
  form.customerId = row.customerId
  form.warehouseCode = row.warehouseCode || ''
  form.qcUnitPrice = Number(row.qcUnitPrice || 0)
  form.measureUnitPrice = Number(row.measureUnitPrice || 0)
  form.labelUnitPrice = Number(row.labelUnitPrice || 0)
  form.putawayUnitPrice = Number(row.putawayUnitPrice || 0)
  form.receiveUnitPrice = Number(row.receiveUnitPrice || 0)
  form.receiveCartonPrice = Number(row.receiveCartonPrice || 0)
  form.enabled = row.enabled !== false
  form.effectiveFrom = row.effectiveFrom || ''
  form.effectiveTo = row.effectiveTo || ''
  dialogVisible.value = true
}

async function save() {
  if (!form.ruleName.trim()) {
    ElMessage.warning('请填写规则名称')
    return
  }
  const payload = {
    ...form,
    customerId: form.customerId || null,
    warehouseCode: form.warehouseCode || null,
    effectiveFrom: form.effectiveFrom || null,
    effectiveTo: form.effectiveTo || null,
  }
  if (editingId.value) await inboundFeeApi.update(editingId.value, payload)
  else await inboundFeeApi.create(payload)
  ElMessage.success(editingId.value ? '规则已更新' : '规则已创建')
  dialogVisible.value = false
  await load()
}

async function toggleEnabled(row: any) {
  await inboundFeeApi.update(row.id, {
    ruleName: row.ruleName,
    customerId: row.customerId,
    warehouseCode: row.warehouseCode || null,
    qcUnitPrice: row.qcUnitPrice,
    measureUnitPrice: row.measureUnitPrice,
    labelUnitPrice: row.labelUnitPrice,
    putawayUnitPrice: row.putawayUnitPrice,
    receiveUnitPrice: row.receiveUnitPrice,
    receiveCartonPrice: row.receiveCartonPrice,
    enabled: !row.enabled,
    effectiveFrom: row.effectiveFrom || null,
    effectiveTo: row.effectiveTo || null,
  })
  await load()
}

onMounted(load)
</script>

<template>
  <div class="inbound-fee-page">
    <el-card class="head-card">
      <div class="page-head">
        <div>
          <h2>入库计费规则</h2>
          <p>清点、测量、贴标、上架提交后按规则写入客户结算，费用单号挂入库单。</p>
        </div>
        <el-button v-if="canManage" type="primary" @click="openCreate">新建规则</el-button>
      </div>
    </el-card>

    <el-card v-loading="loading">
      <el-table :data="rows" stripe>
        <el-table-column prop="ruleName" label="规则" min-width="160" />
        <el-table-column label="客户" min-width="160">
          <template #default="s">{{ s.row.customerCode ? `${s.row.customerCode} ${s.row.customerName}` : '全部客户' }}</template>
        </el-table-column>
        <el-table-column label="仓库" width="140">
          <template #default="s">{{ s.row.warehouseCode || '全部仓库' }}</template>
        </el-table-column>
        <el-table-column prop="qcUnitPrice" label="清点/件" width="100" />
        <el-table-column prop="measureUnitPrice" label="测量/SKU" width="110" />
        <el-table-column prop="labelUnitPrice" label="贴标/件" width="100" />
        <el-table-column prop="putawayUnitPrice" label="上架/件" width="100" />
        <el-table-column label="状态" width="90">
          <template #default="s">
            <el-tag :type="s.row.enabled ? 'success' : 'info'" size="small">{{ s.row.enabled ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生效" min-width="180">
          <template #default="s">{{ s.row.effectiveFrom || '不限' }} ~ {{ s.row.effectiveTo || '不限' }}</template>
        </el-table-column>
        <el-table-column v-if="canManage" label="操作" width="150" fixed="right">
          <template #default="s">
            <el-button link type="primary" @click="openEdit(s.row)">编辑</el-button>
            <el-button link @click="toggleEnabled(s.row)">{{ s.row.enabled ? '停用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑入库计费规则' : '新建入库计费规则'" width="640px">
      <el-form label-width="110px">
        <el-form-item label="规则名称"><el-input v-model="form.ruleName" maxlength="100" /></el-form-item>
        <el-form-item label="客户">
          <el-select v-model="form.customerId" clearable filterable placeholder="全部客户" style="width:100%">
            <el-option v-for="c in customers" :key="c.id" :label="c.label" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库">
          <el-select v-model="form.warehouseCode" clearable filterable placeholder="全部仓库" style="width:100%">
            <el-option
              v-for="wh in warehouses"
              :key="wh.warehouseCode || wh.code"
              :label="wh.warehouseName || wh.name"
              :value="wh.warehouseCode || wh.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="清点单价"><el-input-number v-model="form.qcUnitPrice" :min="0" :precision="4" :step="0.1" /></el-form-item>
        <el-form-item label="测量单价"><el-input-number v-model="form.measureUnitPrice" :min="0" :precision="4" :step="0.1" /></el-form-item>
        <el-form-item label="贴标单价"><el-input-number v-model="form.labelUnitPrice" :min="0" :precision="4" :step="0.1" /></el-form-item>
        <el-form-item label="上架单价"><el-input-number v-model="form.putawayUnitPrice" :min="0" :precision="4" :step="0.1" /></el-form-item>
        <el-form-item label="生效开始"><el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="生效结束"><el-date-picker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.inbound-fee-page { display: grid; gap: 16px; }
.head-card :deep(.el-card__body) { padding-bottom: 16px; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-head h2 { margin: 0 0 5px; font-size: 22px; color: #17223b; }
.page-head p { margin: 0; color: #768196; font-size: 13px; }
</style>
