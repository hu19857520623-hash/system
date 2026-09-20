<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { takealotDestApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { withAction } from '@/composables/useListLoader.ts'
import { loadTakealotDestConfig, type TakealotDestItem } from '@/composables/useTakealotDestConfig.ts'

const app = useAppStore()
const canManage = () => app.hasPerm('logistics_wh.manage')
const rows = ref<TakealotDestItem[]>([])
const loading = ref(false)

async function reload() {
  loading.value = true
  try {
    const res = await takealotDestApi.list({ includeDisabled: 'true' }) as { items?: TakealotDestItem[] }
    rows.value = res.items || []
  } finally {
    loading.value = false
  }
}

function blankRow(): TakealotDestItem {
  return {
    code: '',
    omsWarehouseId: '',
    label: '',
    city: '',
    matchAliases: [],
    enabled: true,
    sortOrder: (rows.value.length + 1) * 10,
  }
}

const draft = ref<TakealotDestItem | null>(null)
const dialogOpen = ref(false)

function openCreate() {
  draft.value = blankRow()
  dialogOpen.value = true
}

function openEdit(row: TakealotDestItem) {
  draft.value = { ...row, matchAliases: [...(row.matchAliases || [])] }
  dialogOpen.value = true
}

function closeDialog() {
  dialogOpen.value = false
  draft.value = null
}

function aliasesText(row: TakealotDestItem) {
  return (row.matchAliases || []).join(', ')
}

function setAliasesFromText(row: TakealotDestItem, text: string) {
  row.matchAliases = text.split(/[,，\s]+/).map((v) => v.trim().toUpperCase()).filter(Boolean)
}

async function saveDraft() {
  if (!draft.value) return
  const d = draft.value
  if (!d.code.trim()) {
    ElMessage.warning('请填写目的仓代码')
    return
  }
  const payload = {
    code: d.code.trim(),
    omsWarehouseId: d.omsWarehouseId?.trim() || null,
    label: (d.label || d.code).trim(),
    city: d.city?.trim() || null,
    matchAliases: d.matchAliases,
    enabled: d.enabled,
    sortOrder: d.sortOrder,
  }
  const ok = await withAction(async () => {
    if (d.id) await takealotDestApi.update(d.id, payload)
    else await takealotDestApi.create(payload)
    closeDialog()
    await reload()
    await loadTakealotDestConfig(true)
  }, '已保存')
  if (!ok) return
}

async function toggleRow(row: TakealotDestItem) {
  if (!canManage() || !row.id) return
  await withAction(async () => {
    await takealotDestApi.update(row.id!, { enabled: !row.enabled })
    await reload()
    await loadTakealotDestConfig(true)
  }, row.enabled ? '已停用' : '已启用')
}

onMounted(reload)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <div>
          <span class="page-title">Takealot 目的仓配置</span>
          <p class="page-desc">
            用于客户结算「送达地点」筛选、出库 fbaWarehouse 匹配与 OMS 预约发货目的仓下拉；与 ERP 海外仓主数据（WMS 编码）独立维护。
          </p>
        </div>
        <el-button v-if="canManage()" type="primary" size="small" @click="openCreate">新增</el-button>
      </div>
    </template>

    <el-table :data="rows" stripe border size="small">
      <el-table-column prop="code" label="代码" width="90" />
      <el-table-column prop="omsWarehouseId" label="OMS 仓 id" width="100">
        <template #default="{ row }"><span class="mono">{{ row.omsWarehouseId || '—' }}</span></template>
      </el-table-column>
      <el-table-column prop="label" label="显示名" width="100" />
      <el-table-column prop="city" label="城市" width="110" />
      <el-table-column label="匹配别名" min-width="160">
        <template #default="{ row }"><span class="mono">{{ aliasesText(row as TakealotDestItem) }}</span></template>
      </el-table-column>
      <el-table-column prop="sortOrder" label="排序" width="70" align="center" />
      <el-table-column label="启用" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="canManage()" label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row as TakealotDestItem)">编辑</el-button>
          <el-button link size="small" @click="toggleRow(row as TakealotDestItem)">{{ row.enabled ? '停用' : '启用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogOpen" :title="draft?.id ? `编辑 · ${draft.code}` : '新增目的仓'" width="520px" destroy-on-close @close="closeDialog">
    <el-form v-if="draft" label-width="110px" size="small">
      <el-form-item label="代码" required>
        <el-input v-model="draft.code" placeholder="如 JHB3" :disabled="!!draft.id" />
      </el-form-item>
      <el-form-item label="OMS 仓 id">
        <el-input v-model="draft.omsWarehouseId" placeholder="如 jhb3，供 OMS 下拉" />
      </el-form-item>
      <el-form-item label="显示名">
        <el-input v-model="draft.label" />
      </el-form-item>
      <el-form-item label="城市">
        <el-input v-model="draft.city" placeholder="约翰内斯堡 / 开普敦 / 德班" />
      </el-form-item>
      <el-form-item label="匹配别名">
        <el-input
          :model-value="aliasesText(draft)"
          placeholder="逗号分隔，用于 fbaWarehouse 与账单匹配"
          @update:model-value="(v: string) => setAliasesFromText(draft!, v)"
        />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="draft.sortOrder" :min="0" :step="10" />
      </el-form-item>
      <el-form-item label="启用">
        <el-switch v-model="draft.enabled" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="closeDialog">取消</el-button>
      <el-button type="primary" @click="saveDraft">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-title { font-weight: 600; font-size: 15px; }
.page-desc { margin: 6px 0 0; font-size: 12px; color: var(--text-muted, #8b95a8); max-width: 640px; line-height: 1.5; }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
</style>
