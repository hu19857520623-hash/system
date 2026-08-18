<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/client.js'
import { mapSupplier } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import ListPagination from '@/components/ListPagination.vue'

const searchQ = ref('')

const { loading, items: suppliers, load } = useListLoader(async () => {
  const res = await supplierApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(mapSupplier), total: res.total }
})

onMounted(() => load())

const filtered = computed(() => {
  const q = searchQ.value.trim().toLowerCase()
  if (!q) return suppliers.value
  return suppliers.value.filter(s =>
    String(s.code).toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q) ||
    s.contact.toLowerCase().includes(q)
  )
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(filtered)
watch(searchQ, resetPage)

const dialogVisible = ref(false)
const dialogTitle = ref('添加供应商')
const editingId = ref<number | null>(null)
const form = ref({ name: '', contact: '', phone: '', settle: '现结' })

function openAdd() {
  editingId.value = null
  dialogTitle.value = '添加供应商'
  form.value = { name: '', contact: '', phone: '', settle: '现结' }
  dialogVisible.value = true
}

function openEdit(row: any) {
  editingId.value = row.id
  dialogTitle.value = `编辑供应商 · ${row.code}`
  form.value = { name: row.name, contact: row.contact, phone: row.phone, settle: row.settle || '现结' }
  dialogVisible.value = true
}

async function save() {
  if (!form.value.name.trim()) { ElMessage.warning('请填写供应商名称'); return }
  if (!form.value.contact.trim()) { ElMessage.warning('请填写联系人'); return }
  if (!form.value.phone.trim()) { ElMessage.warning('请填写电话'); return }
  if (!form.value.settle) { ElMessage.warning('请选择结算方式'); return }
  const payload = {
    supplierName: form.value.name,
    contactName: form.value.contact,
    contactPhone: form.value.phone,
    paymentTerms: form.value.settle,
  }
  const ok = await withAction(async () => {
    if (editingId.value) {
      await supplierApi.update(editingId.value, payload)
    } else {
      await supplierApi.create(payload)
    }
  }, editingId.value ? '供应商已更新' : '供应商已添加')
  if (ok) {
    dialogVisible.value = false
    load()
  }
}

async function removeSupplier(row: any) {
  try {
    await ElMessageBox.confirm(
      `删除后不可恢复，确认删除供应商「${row.name}」？`,
      '删除供应商',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const ok = await withAction(async () => {
    await supplierApi.remove(row.id)
  }, '供应商已删除')
  if (ok) {
    resetPage()
    load()
  }
}
</script>

<template>
  <div class="suppliers-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span class="page-title">供应商管理</span>
          <div class="header-actions">
            <el-input v-model="searchQ" placeholder="搜索供应商名称 / 编码" clearable style="width: 200px" size="small" />
            <el-button type="primary" size="small" @click="openAdd">添加供应商</el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" :data="pagedItems" stripe border style="width: 100%" size="small">
        <el-table-column prop="code" label="编码" width="110">
          <template #default="{ row }">
            <span style="font-family: var(--font-mono); font-size: 12px">{{ row.code }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column prop="contact" label="联系人" width="100" />
        <el-table-column prop="settle" label="结算" width="90" />
        <el-table-column prop="term" label="账期" width="80" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === '合作中' ? 'success' : 'info'" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="openPo" label="在途PO" width="80" align="center" />
        <el-table-column label="操作" width="145" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeSupplier(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px">
      <el-form label-width="96px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="供应商名称" />
        </el-form-item>
        <el-form-item label="联系人" required>
          <el-input v-model="form.contact" placeholder="联系人" />
        </el-form-item>
        <el-form-item label="电话" required>
          <el-input v-model="form.phone" placeholder="电话" />
        </el-form-item>
        <el-form-item label="结算方式" required>
          <el-select v-model="form.settle" placeholder="选择" style="width:100%">
            <el-option label="现结" value="现结" />
            <el-option label="月结" value="月结" />
            <el-option label="预付30%" value="预付30%" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-weight: 600; font-size: 15px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
</style>
