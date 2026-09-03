<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { warehouseApi, warehouseZoneApi, locationApi } from '@/api/client.js'
import { mapWarehouse } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'

const app = useAppStore()

const PARTITION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const ZONE_TYPE_LABEL: Record<string, string> = {
  storage: '存储区',
  staging: '待上架区',
  qc: '质检区',
  return: '退货区',
}

const STATUS_LABEL: Record<string, string> = {
  available: '可用',
  disabled: '停用',
  locked: '锁定',
}

const selectedWarehouse = ref('')
const selectedZoneId = ref<number | 'all'>('all')
const selectedRows = ref<any[]>([])

const warehouses = ref<any[]>([])
const zones = ref<any[]>([])
const usedPartitionLetters = ref<string[]>([])

const canEdit = computed(() => app.hasPerm('warehouse_location.edit'))
const canBatch = computed(() => app.hasPerm('warehouse_location.batch_create'))
const canView = computed(() => app.hasPerm('warehouse_location.view'))
const canSetCapacity = computed(() => app.hasPerm('logistics_wh.manage') || app.hasPerm('capacity.manage'))
const currentWarehouse = computed(() => warehouses.value.find((wh) => (wh.code || wh.warehouseCode) === selectedWarehouse.value) || null)
const capDialog = ref(false)
const capValue = ref<number | null>(null)

function openWarehouseCap() {
  if (!currentWarehouse.value?.id) return ElMessage.warning('请先选择仓库')
  capValue.value = currentWarehouse.value.totalVolumeCbm != null ? Number(currentWarehouse.value.totalVolumeCbm) : null
  capDialog.value = true
}

async function saveWarehouseCap() {
  if (!currentWarehouse.value?.id) return
  const ok = await withAction(async () => {
    await warehouseApi.updateCapacity(currentWarehouse.value.id, { totalVolumeCbm: capValue.value })
    await loadWarehouses()
  }, '仓级上限已保存')
  if (ok) capDialog.value = false
}

function warehouseShortCode(code: string) {
  const parts = code.split('-').filter(Boolean)
  if (parts[0] === 'WMS' && parts[1]) return parts[1]
  return parts[parts.length - 1] || code.slice(0, 6)
}

function extractPartitionCode(zoneCode: string) {
  if (/^[A-Z]$/.test(zoneCode)) return zoneCode
  const m = zoneCode.match(/(?:^|-)([A-Z])(?:-|$)/)
  return m ? m[1] : zoneCode.slice(0, 1).toUpperCase()
}

const { loading, items: locations, load: loadLocations } = useListLoader(async () => {
  if (!selectedWarehouse.value) return { items: [], total: 0 }
  const params: any = { warehouseCode: selectedWarehouse.value }
  if (selectedZoneId.value !== 'all') params.zoneId = selectedZoneId.value
  const rows = await locationApi.list(params)
  const list = Array.isArray(rows) ? rows : rows.items || []
  return { items: list, total: list.length }
})

const { page, pageSize, total, pagedItems } = useTablePagination(locations)

async function loadWarehouses() {
  try {
    const res = await warehouseApi.list({ type: 'overseas' })
    const rows = (Array.isArray(res) ? res : res.items || []).map(mapWarehouse)
    warehouses.value = rows
    if (!selectedWarehouse.value && warehouses.value.length) {
      selectedWarehouse.value = warehouses.value[0].code || warehouses.value[0].warehouseCode
    }
  } catch {
    warehouses.value = []
  }
}

async function loadUsedLetters() {
  if (!selectedWarehouse.value) {
    usedPartitionLetters.value = []
    return
  }
  try {
    const rows = await warehouseZoneApi.partitionLetters(selectedWarehouse.value)
    usedPartitionLetters.value = Array.isArray(rows) ? rows : []
  } catch {
    usedPartitionLetters.value = []
  }
}

async function loadZones() {
  if (!selectedWarehouse.value) {
    zones.value = []
    return
  }
  try {
    const rows = await warehouseZoneApi.list({ warehouseCode: selectedWarehouse.value })
    zones.value = Array.isArray(rows) ? rows : rows.items || []
  } catch {
    zones.value = []
  }
  await loadUsedLetters()
}

onMounted(async () => {
  await loadWarehouses()
  await loadZones()
  await loadLocations()
})

watch(selectedWarehouse, async () => {
  selectedZoneId.value = 'all'
  selectedRows.value = []
  await loadZones()
  await loadLocations()
})

watch(selectedZoneId, () => {
  selectedRows.value = []
  loadLocations()
})

// ── 新建 / 编辑库区 ──
const zoneDialogVisible = ref(false)
const zoneEditMode = ref(false)
const zoneEditId = ref<number | null>(null)
const zoneForm = ref({
  zoneCode: '',
  zoneName: '',
  zoneType: 'storage',
  remark: '',
  status: 1,
  locationCode: '',
})

const availablePartitionLetters = computed(() =>
  PARTITION_LETTERS.filter((l) => !usedPartitionLetters.value.includes(l) || zoneForm.value.zoneCode === l),
)

function defaultLocationCode(zoneCode: string) {
  if (!selectedWarehouse.value || !zoneCode) return ''
  return `${warehouseShortCode(selectedWarehouse.value)}-${zoneCode}-01-100`
}

function parseLocationParts(locationCode: string, fallbackZone: string) {
  const parts = locationCode.split('-').filter(Boolean)
  // JHB-A-01-100 或 WMS-JHB-A-01-100 等，取末尾三段附近
  if (parts.length >= 3) {
    const bin = parts[parts.length - 1]
    const rack = parts[parts.length - 2]
    const aisle = parts[parts.length - 3]
    return {
      aisle: /^[A-Z]$/i.test(aisle) ? aisle.toUpperCase() : fallbackZone,
      rack,
      bin,
    }
  }
  return { aisle: fallbackZone, rack: '01', bin: '100' }
}

function openZoneDialog() {
  if (!selectedWarehouse.value) {
    ElMessage.warning('请先选择仓库')
    return
  }
  zoneEditMode.value = false
  zoneEditId.value = null
  const next = availablePartitionLetters.value[0] || ''
  zoneForm.value = {
    zoneCode: next,
    zoneName: next ? `${next} 区` : '',
    zoneType: 'storage',
    remark: '',
    status: 1,
    locationCode: defaultLocationCode(next),
  }
  zoneDialogVisible.value = true
  if (!next) {
    ElMessage.warning('当前仓库 A–Z 分区已用完')
  }
}

function onZoneCodeChange(val: string | number) {
  const code = String(val || '').trim().toUpperCase()
  zoneForm.value.zoneCode = code
  if (!zoneEditMode.value && /^[A-Z]$/.test(code)) {
    zoneForm.value.zoneName = `${code} 区`
    zoneForm.value.locationCode = defaultLocationCode(code)
  }
}

function openZoneEdit(row: any) {
  zoneEditMode.value = true
  zoneEditId.value = row.id
  zoneForm.value = {
    zoneCode: row.zoneCode,
    zoneName: row.zoneName,
    zoneType: row.zoneType || 'storage',
    remark: row.remark || '',
    status: row.status ?? 1,
    locationCode: '',
  }
  zoneDialogVisible.value = true
}

watch(
  () => zoneForm.value.zoneCode,
  (code) => {
    const normalized = String(code || '').trim().toUpperCase()
    if (normalized !== code) zoneForm.value.zoneCode = normalized
    if (!zoneEditMode.value && normalized && /^[A-Z]$/.test(normalized) && !zoneForm.value.zoneName.trim()) {
      zoneForm.value.zoneName = `${normalized} 区`
    }
  },
)

async function submitZone() {
  const zoneCode = String(zoneForm.value.zoneCode || '').trim().toUpperCase()
  zoneForm.value.zoneCode = zoneCode
  const locationCode = String(zoneForm.value.locationCode || '').trim().toUpperCase()
  if (!zoneCode || !zoneForm.value.zoneName.trim()) {
    ElMessage.warning('请填写库区编码和库区名称')
    return
  }
  if (!/^[A-Z]$/.test(zoneCode)) {
    ElMessage.warning('库区编码须为 A-Z 单字母（如 A、B、C）')
    return
  }
  if (!zoneEditMode.value && !availablePartitionLetters.value.includes(zoneCode)) {
    ElMessage.warning(`库区编码 ${zoneCode} 已被使用或不可用`)
    return
  }
  if (!zoneEditMode.value && !locationCode) {
    ElMessage.warning('请填写库位编码')
    return
  }
  const ok = await withAction(async () => {
    if (zoneEditMode.value && zoneEditId.value) {
      await warehouseZoneApi.update(zoneEditId.value, {
        zoneName: zoneForm.value.zoneName,
        zoneType: zoneForm.value.zoneType,
        remark: zoneForm.value.remark,
        status: zoneForm.value.status,
      })
    } else {
      const created = await warehouseZoneApi.create({
        warehouseCode: selectedWarehouse.value,
        zoneCode,
        zoneName: zoneForm.value.zoneName,
        zoneType: zoneForm.value.zoneType,
        remark: zoneForm.value.remark,
      })
      const parts = parseLocationParts(locationCode, zoneCode)
      await locationApi.create({
        warehouseCode: selectedWarehouse.value,
        zoneId: created.id,
        locationCode,
        aisle: parts.aisle,
        rack: parts.rack,
        bin: parts.bin,
        status: 'available',
      })
      selectedZoneId.value = created.id
    }
    await loadZones()
    await loadLocations()
  }, zoneEditMode.value ? '库区已更新' : '库区与库位已创建')
  if (ok) zoneDialogVisible.value = false
}

// ── 批量生成库位 ──
const batchDialogVisible = ref(false)
const batchForm = ref({
  zoneInput: '',
  partitionCode: 'A',
  rackNo: '01',
  startNum: 1,
  endNum: 20,
  padLength: 2,
})

function zoneDisplayLabel(z: any) {
  return z.zoneName
}

function resolveBatchZoneId() {
  const input = batchForm.value.zoneInput.trim()
  if (!input) return null
  const exact = zones.value.find(
    (z: any) => zoneDisplayLabel(z) === input || z.zoneName === input || z.zoneCode === input,
  )
  if (exact) return exact.id
  const byLetter = zones.value.find(
    (z: any) => extractPartitionCode(z.zoneCode) === input || extractPartitionCode(z.zoneCode) === batchForm.value.partitionCode,
  )
  return byLetter?.id ?? null
}

const batchPrefixPreview = computed(() => {
  if (!selectedWarehouse.value || !batchForm.value.partitionCode || !batchForm.value.rackNo) return ''
  const rack = String(batchForm.value.rackNo).padStart(2, '0')
  return `${warehouseShortCode(selectedWarehouse.value)}-${batchForm.value.partitionCode}-${rack}-`
})

const batchSampleCode = computed(() => {
  if (!batchPrefixPreview.value) return ''
  return `${batchPrefixPreview.value}${String(batchForm.value.startNum).padStart(batchForm.value.padLength, '0')}`
})

function openBatchDialog() {
  const zoneId = selectedZoneId.value === 'all' ? zones.value[0]?.id ?? null : selectedZoneId.value
  const z = zones.value.find((row: any) => row.id === zoneId)
  batchForm.value = {
    zoneInput: z ? zoneDisplayLabel(z) : '',
    partitionCode: z ? extractPartitionCode(z.zoneCode) : 'A',
    rackNo: '01',
    startNum: 1,
    endNum: 20,
    padLength: 2,
  }
  batchDialogVisible.value = true
}

async function submitBatch() {
  const zoneId = resolveBatchZoneId()
  if (!zoneId) {
    ElMessage.warning('未找到对应分区，请检查输入或先新建分区')
    return
  }
  const count = batchForm.value.endNum - batchForm.value.startNum + 1
  const ok = await withAction(async () => {
    await locationApi.batchCreate({
      warehouseCode: selectedWarehouse.value,
      zoneId,
      partitionCode: batchForm.value.partitionCode,
      rackNo: batchForm.value.rackNo,
      prefix: batchPrefixPreview.value,
      startNum: batchForm.value.startNum,
      endNum: batchForm.value.endNum,
      padLength: batchForm.value.padLength,
    })
    await loadZones()
    await loadLocations()
  }, `已生成 ${count} 个库位`)
  if (ok) batchDialogVisible.value = false
}

async function toggleLocationStatus(row: any) {
  if (!canEdit.value) return
  const next = row.status === 'available' ? 'disabled' : 'available'
  const ok = await withAction(async () => {
    await locationApi.update(row.id, { status: next })
    await loadLocations()
  }, `库位 ${row.locationCode} 已${next === 'disabled' ? '停用' : '启用'}`)
  if (!ok) loadLocations()
}

// ── 库位库存详情 ──
const invDialogVisible = ref(false)
const invDetail = ref<any>(null)

async function showInventory(row: any) {
  try {
    invDetail.value = await locationApi.inventory(row.id)
    invDialogVisible.value = true
  } catch (e: any) {
    ElMessage.error(e.message || '加载库位库存失败')
  }
}

// ── 标签打印 ──
async function printOne(row: any) {
  if (!canView.value) return
  try {
    await locationApi.printLabel(row.id)
  } catch (e: any) {
    ElMessage.error(e.message || '打印失败')
  }
}

async function printSelected() {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选要打印的库位')
    return
  }
  try {
    await locationApi.printLabels({ ids: selectedRows.value.map((r) => r.id).join(',') })
  } catch (e: any) {
    ElMessage.error(e.message || '打印失败')
  }
}

async function printCurrentZone() {
  if (!locations.value.length) {
    ElMessage.warning('当前没有可打印的库位')
    return
  }
  try {
    const params: any = { warehouseCode: selectedWarehouse.value }
    if (selectedZoneId.value !== 'all') params.zoneId = selectedZoneId.value
    await locationApi.printLabels(params)
  } catch (e: any) {
    ElMessage.error(e.message || '打印失败')
  }
}
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">库位管理</span>
        <div class="header-actions">
          <el-button v-if="canView" size="small" :disabled="!selectedRows.length" @click="printSelected">
            打印选中标签
          </el-button>
          <el-button v-if="canView" size="small" :disabled="!locations.length" @click="printCurrentZone">
            打印当前列表
          </el-button>
          <el-button v-if="canEdit" size="small" @click="openZoneDialog">新建分区</el-button>
          <el-button v-if="canBatch" type="primary" size="small" :disabled="!zones.length" @click="openBatchDialog">
            批量生成库位
          </el-button>
        </div>
      </div>
    </template>

    <div class="callout info">
      <div class="callout-title">仓库 → 分区 (A-Z) → 库位</div>
      <div class="callout-body">
        先按 A-Z 创建库区分区，再按「分区-货架-序号」批量生成库位（如 JHB-A-01-100）。生成后可打印库位标签贴到货架。
      </div>
    </div>

    <div class="filter-row">
      <span class="filter-label">仓库</span>
      <el-select v-model="selectedWarehouse" placeholder="选择仓库" style="width:220px" size="small">
        <el-option
          v-for="wh in warehouses"
          :key="wh.code || wh.warehouseCode"
          :label="`${wh.name} (${wh.code})`"
          :value="wh.code"
        />
      </el-select>
      <span class="filter-label">仓级上限</span>
      <strong>{{ currentWarehouse?.totalVolumeCbm != null ? `${currentWarehouse.totalVolumeCbm} m³` : '未设置' }}</strong>
      <el-button v-if="canSetCapacity" size="small" @click="openWarehouseCap">设置</el-button>
    </div>

    <div v-if="zones.length" class="zone-panel">
      <div class="zone-panel-title">库区分区</div>
      <div class="zone-cards">
        <div v-for="z in zones" :key="z.id" class="zone-card" :class="{ active: selectedZoneId === z.id }" @click="selectedZoneId = z.id">
          <div class="zone-card-code">{{ z.zoneCode }}</div>
          <div class="zone-card-name">{{ z.zoneName }}</div>
          <div class="zone-card-meta">
            {{ ZONE_TYPE_LABEL[z.zoneType] || z.zoneType }} · {{ z.locationCount ?? 0 }} 库位
          </div>
          <el-button v-if="canEdit" link type="primary" size="small" class="zone-edit-btn" @click.stop="openZoneEdit(z)">
            编辑
          </el-button>
        </div>
        <div
          class="zone-card zone-card-all"
          :class="{ active: selectedZoneId === 'all' }"
          @click="selectedZoneId = 'all'"
        >
          <div class="zone-card-code">*</div>
          <div class="zone-card-name">全部库区</div>
          <div class="zone-card-meta">{{ locations.length }} 库位</div>
        </div>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="pagedItems"
      stripe
      border
      size="small"
      @selection-change="(rows: any[]) => (selectedRows = rows)"
    >
      <el-table-column type="selection" width="42" />
      <el-table-column prop="locationCode" label="库位编码" width="140">
        <template #default="{ row }"><span class="mono">{{ row.locationCode }}</span></template>
      </el-table-column>
      <el-table-column prop="zoneName" label="分区" width="100" />
      <el-table-column label="类型" width="90">
        <template #default="{ row }">{{ ZONE_TYPE_LABEL[row.zoneType] || row.zoneType }}</template>
      </el-table-column>
      <el-table-column label="货架结构" width="120">
        <template #default="{ row }">
          <span class="mono">{{ [row.aisle, row.rack, row.level, row.bin].filter(Boolean).join('-') || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU 数" width="80" align="right">
        <template #default="{ row }">{{ row.skuCount ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'available' ? 'success' : row.status === 'locked' ? 'warning' : 'info'"
            size="small"
          >{{ STATUS_LABEL[row.status] || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canView" link type="primary" size="small" @click="printOne(row)">打印</el-button>
          <el-button link type="primary" size="small" @click="showInventory(row)">库存</el-button>
          <el-button
            v-if="canEdit && row.status !== 'locked'"
            link
            :type="row.status === 'available' ? 'danger' : 'primary'"
            size="small"
            @click="toggleLocationStatus(row)"
          >{{ row.status === 'available' ? '停用' : '启用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !locations.length" description="暂无库位，请先新建分区并批量生成" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />

    <!-- 新建 / 编辑分区 -->
    <el-dialog v-model="zoneDialogVisible" :title="zoneEditMode ? '编辑库区' : '新建库区分区'" width="480px">
      <el-form label-width="100px" size="small">
        <el-form-item label="所属仓库">
          <el-input :model-value="selectedWarehouse" disabled />
        </el-form-item>
        <el-form-item label="库区编码" required>
          <el-select
            v-model="zoneForm.zoneCode"
            :disabled="zoneEditMode"
            filterable
            allow-create
            default-first-option
            placeholder="填写 A-Z 单字母，如 A、B、C"
            style="width:100%"
            @change="onZoneCodeChange"
          >
            <el-option
              v-for="letter in (zoneEditMode ? [zoneForm.zoneCode] : availablePartitionLetters)"
              :key="letter"
              :label="letter"
              :value="letter"
            />
          </el-select>
          <div class="field-hint">必填。库区编码为 A–Z 单字母，用于生成库位号（如 JHB-A-01-01）</div>
          <div v-if="!zoneEditMode && !availablePartitionLetters.length" class="field-hint field-hint-warn">
            当前仓库 A–Z 分区已用完，无法再建新分区
          </div>
        </el-form-item>
        <el-form-item label="库区名称" required>
          <el-input v-model="zoneForm.zoneName" placeholder="如 A 区存储" />
        </el-form-item>
        <el-form-item v-if="!zoneEditMode" label="库位编码" required>
          <el-input
            v-model="zoneForm.locationCode"
            placeholder="如 JHB-A-01-100"
            class="mono-input"
            @blur="zoneForm.locationCode = zoneForm.locationCode.trim().toUpperCase()"
          />
          <div class="field-hint">新建分区时同时创建该库位，可按需修改编码</div>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="zoneForm.zoneType" style="width:100%">
            <el-option label="存储区" value="storage" />
            <el-option label="待上架区" value="staging" />
            <el-option label="质检区" value="qc" />
            <el-option label="退货区" value="return" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="zoneEditMode" label="状态">
          <el-radio-group v-model="zoneForm.status">
            <el-radio :value="1">启用</el-radio>
            <el-radio :value="0">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="zoneForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="zoneDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!zoneEditMode && !availablePartitionLetters.length" @click="submitZone">
          {{ zoneEditMode ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 批量生成 -->
    <el-dialog v-model="batchDialogVisible" title="批量生成库位" width="480px">
      <el-form label-width="100px" size="small">
        <el-form-item label="所属分区" required>
          <el-input
            v-model="batchForm.zoneInput"
            placeholder="手动输入，如 B 区存储"
            style="width:100%"
          />
        </el-form-item>
        <el-form-item label="分区代码">
          <el-select v-model="batchForm.partitionCode" style="width:120px">
            <el-option v-for="l in PARTITION_LETTERS" :key="l" :label="l" :value="l" />
          </el-select>
          <span class="field-hint">对应 A-Z 分区字母</span>
        </el-form-item>
        <el-form-item label="货架号" required>
          <el-input v-model="batchForm.rackNo" placeholder="如 01" style="width:120px" maxlength="4" />
          <span class="field-hint">2 位货架编号</span>
        </el-form-item>
        <el-form-item label="库位序号">
          <div class="range-row">
            <el-input-number v-model="batchForm.startNum" :min="1" :max="9999" />
            <span>至</span>
            <el-input-number v-model="batchForm.endNum" :min="batchForm.startNum" :max="9999" />
          </div>
        </el-form-item>
        <el-form-item label="序号位数">
          <el-input-number v-model="batchForm.padLength" :min="1" :max="4" />
        </el-form-item>
        <el-form-item label="编码预览">
          <div class="prefix-preview">
            <div>前缀：<span class="mono">{{ batchPrefixPreview || '—' }}</span></div>
            <div>示例：<span class="mono">{{ batchSampleCode || '—' }}</span></div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBatch">生成</el-button>
      </template>
    </el-dialog>

    <!-- 库位库存 -->
    <el-dialog v-model="invDialogVisible" :title="`库位库存 · ${invDetail?.location?.locationCode || ''}`" width="520px">
      <div v-if="invDetail" class="inv-summary">
        合计 <strong>{{ invDetail.totalQty }}</strong> 件 · {{ invDetail.items?.length || 0 }} 个 SKU
      </div>
      <el-table v-if="invDetail?.items?.length" :data="invDetail.items" size="small" border>
        <el-table-column prop="sku" label="SKU" width="120">
          <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
        </el-table-column>
        <el-table-column prop="qty" label="数量" width="80" align="right" />
        <el-table-column prop="batchNo" label="批次" width="100" />
        <el-table-column prop="inboundNo" label="来源入库单" min-width="120" />
      </el-table>
      <el-empty v-else description="该库位暂无库存" :image-size="64" />
    </el-dialog>

    <el-dialog v-model="capDialog" title="仓级总库容" width="440px">
      <el-form label-width="110px">
        <el-form-item label="仓库">{{ currentWarehouse?.name }} ({{ selectedWarehouse }})</el-form-item>
        <el-form-item label="总库容 m³">
          <el-input-number v-model="capValue" :min="0" :precision="4" :step="10" controls-position="right" style="width:100%" />
          <span class="field-hint">容量预警按此上限，不按库位加总。</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="capDialog = false">取消</el-button>
        <el-button type="primary" @click="saveWarehouseCap">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.page-title { font-weight: 600; font-size: 15px; }
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.callout { padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }
.callout.info { background: #eef6ff; border: 1px solid #c5dff8; color: #3d4f63; }
.callout-title { font-weight: 600; margin-bottom: 4px; }
.filter-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.filter-label { font-size: 13px; color: #666; }
.zone-panel { margin-bottom: 12px; }
.zone-panel-title { font-size: 13px; color: #666; margin-bottom: 8px; }
.zone-cards { display: flex; flex-wrap: wrap; gap: 10px; }
.zone-card {
  position: relative; min-width: 120px; padding: 10px 12px; border: 1px solid #dcdfe6;
  border-radius: 8px; cursor: pointer; background: #fff; transition: border-color 0.15s, box-shadow 0.15s;
}
.zone-card:hover { border-color: #409eff; }
.zone-card.active { border-color: #409eff; box-shadow: 0 0 0 1px #409eff inset; background: #f5faff; }
.zone-card-code { font-size: 22px; font-weight: 700; font-family: Consolas, monospace; color: #303133; }
.zone-card-name { font-size: 13px; margin-top: 2px; }
.zone-card-meta { font-size: 11px; color: #909399; margin-top: 4px; }
.zone-edit-btn { position: absolute; top: 6px; right: 6px; }
.mono { font-family: var(--font-mono, Consolas, monospace); font-size: 12px; }
.range-row { display: flex; align-items: center; gap: 8px; }
.field-hint { margin-top: 4px; margin-left: 0; font-size: 12px; color: #909399; line-height: 1.4; }
.el-form-item > span.field-hint { margin-left: 8px; margin-top: 0; display: inline; }
.field-hint-warn { color: #e6a23c; }
.prefix-preview { font-size: 13px; line-height: 1.6; color: #555; }
.inv-summary { font-size: 13px; margin-bottom: 12px; color: #555; }
.mono-input :deep(input) { font-family: Consolas, monospace; letter-spacing: 0.02em; }
</style>
