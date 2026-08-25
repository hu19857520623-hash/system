<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { warehouseApi, inventoryApi, logisticsReceiptApi } from '@/api/client.js'
import { mapWarehouse, mapInventory, mapLogisticsReceipt } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'

const { confirmAction, showDetail } = useRowActions()
const router = useRouter()

const tab = ref('manage')
const stockWarehouse = ref('all')

const { loading: whLoading, items: warehouses, load: loadWarehouses } = useListLoader(async () => {
  const res = await warehouseApi.list({ type: 'logistics' })
  const rows = (Array.isArray(res) ? res : res.items || []).map(mapWarehouse)
  return { items: rows, total: rows.length }
})

const fileConfigLoading = ref(false)
const fileConfigWarehouses = ref<any[]>([])

async function loadFileConfigWarehouses() {
  fileConfigLoading.value = true
  try {
    const res = await warehouseApi.list({})
    fileConfigWarehouses.value = (Array.isArray(res) ? res : res.items || []).map(mapWarehouse)
  } finally {
    fileConfigLoading.value = false
  }
}

const pendingPos = ref<any[]>([])
const pendingLoading = ref(false)

async function loadPendingPos() {
  pendingLoading.value = true
  try {
    const res = await logisticsReceiptApi.listPendingPos({})
    pendingPos.value = res || []
  } catch {
    pendingPos.value = []
  } finally {
    pendingLoading.value = false
  }
}

const { loading: stockLoading, items: stockItems, load: loadStock } = useListLoader(async () => {
  const params: any = { pageSize: 100, warehouseType: 'logistics' }
  if (stockWarehouse.value !== 'all') params.warehouseCode = stockWarehouse.value
  const res = await inventoryApi.query(params)
  return { items: (res.items || []).map(mapInventory), total: res.total }
})

const { loading: receiptLoading, items: receipts, load: loadReceipts } = useListLoader(async () => {
  const params: any = { pageSize: 100 }
  if (stockWarehouse.value !== 'all') params.warehouseCode = stockWarehouse.value
  const res = await logisticsReceiptApi.list(params)
  return { items: (res.items || []).map(mapLogisticsReceipt), total: res.total }
})

onMounted(() => {
  loadWarehouses()
  loadPendingPos()
})

watch(tab, (t) => {
  if (t === 'pending') loadPendingPos()
  if (t === 'stock') loadStock()
  if (t === 'receipts') loadReceipts()
  if (t === 'files') loadFileConfigWarehouses()
})

watch(stockWarehouse, () => {
  if (tab.value === 'stock') loadStock()
  if (tab.value === 'receipts') loadReceipts()
})

const { page: whPage, pageSize: whPageSize, total: whTotal, pagedItems: pagedWarehouses } = useTablePagination(warehouses)
const { page: poPage, pageSize: poPageSize, total: poTotal, pagedItems: pagedPending } = useTablePagination(pendingPos)
const { page: stockPage, pageSize: stockPageSize, total: stockTotal, pagedItems: pagedStock } = useTablePagination(stockItems)
const { page: rcPage, pageSize: rcPageSize, total: rcTotal, pagedItems: pagedReceipts } = useTablePagination(receipts)

// ── 仓库管理 ──
const whDialogVisible = ref(false)
const whEditingId = ref<number | null>(null)
const whForm = ref({
  warehouseCode: '',
  warehouseName: '',
  city: '',
  address: '',
  contactName: '',
  contactPhone: '',
  requiredOutboundFiles: [] as string[],
})

const outboundFileOptions = [
  { value: 'outerLabel', label: '外箱标签' },
  { value: 'skuLabel', label: 'SKU 标签' },
  { value: 'deliveryList', label: '送货清单' },
  { value: 'appointment', label: '预约文件' },
]

function openAddWarehouse() {
  whEditingId.value = null
  whForm.value = { warehouseCode: '', warehouseName: '', city: '', address: '', contactName: '', contactPhone: '', requiredOutboundFiles: [] }
  whDialogVisible.value = true
}

function openEditWarehouse(row: any) {
  whEditingId.value = row.id
  whForm.value = {
    warehouseCode: row.code,
    warehouseName: row.name,
    city: row.city,
    address: row.address,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    requiredOutboundFiles: [...(row.requiredOutboundFiles || [])],
  }
  whDialogVisible.value = true
}

async function submitWarehouse() {
  if (!whForm.value.warehouseCode.trim() || !whForm.value.warehouseName.trim()) {
    ElMessage.warning('请填写仓库编码和名称')
    return
  }
  const ok = await withAction(async () => {
    if (whEditingId.value) {
      await warehouseApi.update(whEditingId.value, {
        warehouseName: whForm.value.warehouseName.trim(),
        city: whForm.value.city.trim() || undefined,
        address: whForm.value.address.trim() || undefined,
        contactName: whForm.value.contactName.trim() || undefined,
        contactPhone: whForm.value.contactPhone.trim() || undefined,
        requiredOutboundFiles: whForm.value.requiredOutboundFiles,
      })
    } else {
      await warehouseApi.create({
        warehouseCode: whForm.value.warehouseCode.trim(),
        warehouseName: whForm.value.warehouseName.trim(),
        warehouseType: 'logistics',
        city: whForm.value.city.trim() || undefined,
        address: whForm.value.address.trim() || undefined,
        contactName: whForm.value.contactName.trim() || undefined,
        contactPhone: whForm.value.contactPhone.trim() || undefined,
        requiredOutboundFiles: whForm.value.requiredOutboundFiles,
        country: 'China',
      })
    }
    await loadWarehouses()
    if (tab.value === 'files') await loadFileConfigWarehouses()
  }, whEditingId.value ? '仓库信息已更新' : '物流仓库已添加')
  if (ok) whDialogVisible.value = false
}

async function toggleWarehouseStatus(row: any) {
  const next = row.statusCode === 1 ? 0 : 1
  const label = next === 1 ? '启用' : '停用'
  if (!await confirmAction(`确认${label}仓库 ${row.name}？`, `${label}仓库`)) return
  const ok = await withAction(async () => {
    await warehouseApi.update(row.id, { status: next })
    await loadWarehouses()
  }, `已${label}`)
  if (!ok) return
}

// ── 登记收货 ──
const receiveVisible = ref(false)
const receiveTarget = ref<any>(null)
const receiveLines = ref<any[]>([])
const receiveRemark = ref('')

function openReceive(row: any) {
  receiveTarget.value = row
  receiveLines.value = row.lines
    .filter((l: any) => l.pendingQty > 0)
    .map((l: any) => ({
      ...l,
      name: l.name || l.productName || l.sku,
      spec: l.spec || '',
      actualQty: l.pendingQty,
      damagedQty: 0,
      _prevDamagedQty: 0,
      qcStatus: 'pass',
      qcRemark: '',
    }))
  receiveRemark.value = ''
  receiveVisible.value = true
}

function onDamagedChange(row: any) {
  const pending = Number(row.pendingQty) || 0
  const prevDamaged = Number(row._prevDamagedQty ?? 0)
  let damaged = Math.max(0, Number(row.damagedQty) || 0)
  damaged = Math.min(damaged, pending)
  row.damagedQty = damaged

  const delta = damaged - prevDamaged
  let actual = Number(row.actualQty) || 0
  if (delta !== 0) actual = Math.max(0, actual - delta)
  if (actual + damaged > pending) actual = Math.max(0, pending - damaged)
  row.actualQty = actual
  row._prevDamagedQty = damaged

  if (row.damagedQty > 0 && row.qcStatus === 'pass') row.qcStatus = 'fail'
}

function onActualChange(row: any) {
  const pending = Number(row.pendingQty) || 0
  let actual = Math.max(0, Number(row.actualQty) || 0)
  actual = Math.min(actual, pending)
  row.actualQty = actual
  const maxDamaged = Math.max(0, pending - actual)
  if ((Number(row.damagedQty) || 0) > maxDamaged) {
    row.damagedQty = maxDamaged
    row._prevDamagedQty = maxDamaged
  }
}

async function submitReceive() {
  if (!receiveTarget.value) return
  const items = receiveLines.value.filter((l) => l.actualQty > 0 || l.damagedQty > 0)
  if (!items.length) { ElMessage.warning('请填写良品实收或破损数量'); return }
  for (const l of items) {
    if (l.actualQty + l.damagedQty > l.pendingQty) {
      ElMessage.warning(`${l.sku} 良品 + 破损超过待收 ${l.pendingQty}`)
      return
    }
  }
  const ok = await withAction(async () => {
    await logisticsReceiptApi.create({
      poId: receiveTarget.value.id,
      warehouseCode: receiveTarget.value.warehouseCode,
      remark: receiveRemark.value,
      items: items.map((l) => ({
        poItemId: l.id,
        sku: l.sku,
        actualQty: l.actualQty,
        damagedQty: l.damagedQty || 0,
        qcStatus: l.qcStatus,
        qcRemark: l.qcRemark || undefined,
      })),
    })
  }, `${receiveTarget.value.poNo} 已登记收货入仓`)
  if (ok) {
    receiveVisible.value = false
    loadPendingPos()
    if (tab.value === 'stock') loadStock()
    if (tab.value === 'receipts') loadReceipts()
  }
}

function receiptDetail(row: any) {
  showDetail(`收货记录 · ${row.receiptNo}`, [
    ['收货单号', row.receiptNo], ['采购单', row.poNo], ['仓库', row.warehouseCode],
    ['操作人', row.operatorName], ['收货时间', row.receivedAt],
    ['备注', row.remark || '—'],
    ['SKU 明细', row.items.map((i: any) => {
      const dmg = i.damagedQty ? ` 破损${i.damagedQty}` : ''
      const qc = i.qcStatus === 'fail' ? ' [QC异常]' : ''
      return `${i.sku} ${i.productName} 良品×${i.actualQty}${dmg}${qc}${i.qcRemark ? ` (${i.qcRemark})` : ''}`
    }).join('\n')],
  ])
}

const warehouseOptions = computed(() => warehouses.value.filter(w => w.statusCode === 1))
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">物流中转仓</span>
        <div class="header-actions">
          <el-select v-if="tab === 'stock' || tab === 'receipts'" v-model="stockWarehouse" size="small" style="width:160px">
            <el-option label="全部物流仓" value="all" />
            <el-option v-for="wh in warehouseOptions" :key="wh.code" :label="wh.name" :value="wh.code" />
          </el-select>
          <el-button v-if="tab === 'stock'" size="small" @click="router.push('/logistics-inventory')">库存查询</el-button>
          <el-button v-if="tab === 'manage'" type="primary" size="small" @click="openAddWarehouse">添加物流仓库</el-button>
        </div>
      </div>
    </template>

    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="中转仓管理" name="manage" />
      <el-tab-pane label="待收货 PO" name="pending" />
      <el-tab-pane label="中转仓库存" name="stock" />
      <el-tab-pane label="收货记录" name="receipts" />
      <el-tab-pane label="出库文件配置" name="files" />
    </el-tabs>

    <!-- 物流仓库管理 -->
    <template v-if="tab === 'manage'">
      <el-table v-loading="whLoading" :data="pagedWarehouses" stripe border size="small" style="width: 100%">
        <el-table-column prop="code" label="仓库编码" width="120">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.code }}</span></template>
        </el-table-column>
        <el-table-column prop="name" label="仓库名称" min-width="140" />
        <el-table-column prop="city" label="城市" width="80" />
        <el-table-column prop="address" label="地址" min-width="160" show-overflow-tooltip />
        <el-table-column prop="contactName" label="联系人" width="90" />
        <el-table-column prop="contactPhone" label="电话" width="120" />
        <el-table-column label="出库必传文件" min-width="190">
          <template #default="{ row }">
            <span v-if="!row.requiredOutboundFiles?.length">不限制</span>
            <el-tag v-for="fileType in row.requiredOutboundFiles" :key="fileType" size="small" style="margin-right:4px">
              {{ outboundFileOptions.find(item => item.value === fileType)?.label || fileType }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.statusCode === 1 ? 'success' : 'info'" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditWarehouse(row)">编辑</el-button>
            <el-button link :type="row.statusCode === 1 ? 'warning' : 'success'" size="small" @click="toggleWarehouseStatus(row)">
              {{ row.statusCode === 1 ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="whPage" v-model:page-size="whPageSize" :total="whTotal" />
    </template>

    <template v-if="tab === 'files'">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
        可按海外仓或物流仓分别配置。勾选后，创建该仓库的出库单必须上传对应文件。
      </el-alert>
      <el-table v-loading="fileConfigLoading" :data="fileConfigWarehouses" stripe border size="small">
        <el-table-column prop="code" label="仓库编码" width="140" />
        <el-table-column prop="name" label="仓库名称" min-width="150" />
        <el-table-column prop="type" label="类型" width="100" />
        <el-table-column label="必传文件" min-width="280">
          <template #default="{ row }">
            <span v-if="!row.requiredOutboundFiles?.length">不限制</span>
            <el-tag v-for="fileType in row.requiredOutboundFiles" :key="fileType" size="small" style="margin-right:4px">
              {{ outboundFileOptions.find(item => item.value === fileType)?.label || fileType }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditWarehouse(row)">配置</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 待收货 PO -->
    <template v-if="tab === 'pending'">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
        采购审核通过的采购单，供应商送货至<strong>物流中转仓</strong>后在此登记收货。良品写入中转仓库存；收货完成后方可在「创建入库单」从中转仓发运至海外仓。
      </el-alert>
      <el-table v-loading="pendingLoading" :data="pagedPending" stripe border size="small" style="width: 100%">
        <el-table-column prop="poNo" label="采购单号" width="150">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px;color:#2563eb">{{ row.poNo }}</span></template>
        </el-table-column>
        <el-table-column prop="supplier" label="供应商" min-width="140" />
        <el-table-column prop="warehouseCode" label="目标中转仓" width="110" />
        <el-table-column prop="skuCount" label="待收 SKU" width="90" align="center" />
        <el-table-column label="SKU / 待收" min-width="220">
          <template #default="{ row }">
            <div v-for="item in row.lines" :key="item.id" class="line-preview">
              <span class="mono">{{ item.sku }}</span>
              <span v-if="item.name" class="line-name" :title="item.name">{{ item.name }}</span>
              <span class="line-pending">× {{ item.pendingQty.toLocaleString() }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="金额 (RMB)" width="120" align="right">
          <template #default="{ row }">¥ {{ row.amount.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="expectedArrival" label="预计到货" width="100" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="openReceive(row)">登记收货</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="poPage" v-model:page-size="poPageSize" :total="poTotal" />
    </template>

    <!-- 仓库库存 -->
    <template v-if="tab === 'stock'">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
        中转仓已收货 SKU 的可用库存；创建入库单时从此处扣减发运数量。
      </el-alert>
      <el-table v-loading="stockLoading" :data="pagedStock" stripe border size="small" style="width: 100%">
        <el-table-column prop="warehouse" label="仓库" width="110">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:11px">{{ row.warehouse }}</span></template>
        </el-table-column>
        <el-table-column prop="sku" label="SKU" width="110">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.sku }}</span></template>
        </el-table-column>
        <el-table-column prop="name" label="商品名" min-width="140" />
        <el-table-column prop="spec" label="规格" width="80" />
        <el-table-column label="在库总量" width="90" align="right">
          <template #default="{ row }">{{ row.total.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="available" label="可用" width="80" align="right">
          <template #default="{ row }"><strong>{{ row.available.toLocaleString() }}</strong></template>
        </el-table-column>
        <el-table-column prop="locked" label="锁定" width="70" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.locked > 0 ? '#e8953a' : '#8b95a8' }">{{ row.locked }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="referenceNo" label="最近单号" width="120">
          <template #default="{ row }"><span style="font-size:11px">{{ row.referenceNo || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="lastInboundDate" label="到货日期" width="100" />
      </el-table>
      <ListPagination v-model:page="stockPage" v-model:page-size="stockPageSize" :total="stockTotal" />
      <el-empty v-if="!stockLoading && !stockItems.length" description="该仓库暂无到货库存" />
    </template>

    <!-- 收货记录 -->
    <template v-if="tab === 'receipts'">
      <el-table v-loading="receiptLoading" :data="pagedReceipts" stripe border size="small" style="width: 100%">
        <el-table-column prop="receiptNo" label="收货单号" min-width="130">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.receiptNo }}</span></template>
        </el-table-column>
        <el-table-column prop="poNo" label="采购单" min-width="150">
          <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.poNo }}</span></template>
        </el-table-column>
        <el-table-column prop="warehouseCode" label="仓库" min-width="110" />
        <el-table-column prop="skuCount" label="SKU数" width="80" align="center" />
        <el-table-column label="实收总量" width="100" align="right">
          <template #default="{ row }">{{ row.totalQty.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="破损" width="70" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.damagedQty > 0 ? '#e85d5d' : '#8b95a8' }">{{ row.damagedQty || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="QC" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.hasQcIssue" type="danger" size="small">异常</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operatorName" label="操作人" min-width="100" />
        <el-table-column prop="receivedAt" label="收货时间" min-width="140" />
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="receiptDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="rcPage" v-model:page-size="rcPageSize" :total="rcTotal" />
    </template>
  </el-card>

  <!-- 添加/编辑仓库 -->
  <el-dialog v-model="whDialogVisible" :title="whEditingId ? '编辑物流仓库' : '添加物流仓库'" width="520px">
    <el-form label-width="90px">
      <el-form-item label="仓库编码" required>
        <el-input v-model="whForm.warehouseCode" placeholder="如 LW-SZ-02" :readonly="!!whEditingId" />
      </el-form-item>
      <el-form-item label="仓库名称" required>
        <el-input v-model="whForm.warehouseName" placeholder="如 深圳华运物流仓" />
      </el-form-item>
      <el-form-item label="城市"><el-input v-model="whForm.city" placeholder="如 深圳" /></el-form-item>
      <el-form-item label="地址"><el-input v-model="whForm.address" placeholder="详细地址" /></el-form-item>
      <el-form-item label="联系人"><el-input v-model="whForm.contactName" /></el-form-item>
      <el-form-item label="联系电话"><el-input v-model="whForm.contactPhone" /></el-form-item>
      <el-form-item label="出库必传">
        <el-checkbox-group v-model="whForm.requiredOutboundFiles">
          <el-checkbox v-for="item in outboundFileOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-checkbox>
        </el-checkbox-group>
        <div style="color:#8b95a8;font-size:12px;line-height:18px">勾选后，创建该仓库出库单时缺少对应文件将无法提交。</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="whDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="whLoading" @click="submitWarehouse">保存</el-button>
    </template>
  </el-dialog>

  <!-- 登记收货 -->
  <el-dialog
    v-model="receiveVisible"
    :title="'登记收货 · ' + (receiveTarget?.poNo || '')"
    width="960px"
    class="receive-dialog"
    destroy-on-close
  >
    <template v-if="receiveTarget">
      <el-descriptions :column="3" border size="small" class="receive-summary">
        <el-descriptions-item label="供应商" :span="2">{{ receiveTarget.supplier }}</el-descriptions-item>
        <el-descriptions-item label="目标仓库">{{ receiveTarget.warehouseCode }}</el-descriptions-item>
        <el-descriptions-item label="预计到货">{{ receiveTarget.expectedArrival || '—' }}</el-descriptions-item>
        <el-descriptions-item label="订单金额">¥ {{ receiveTarget.amount?.toLocaleString?.() ?? receiveTarget.amount }}</el-descriptions-item>
        <el-descriptions-item label="待收 SKU">{{ receiveTarget.skuCount }} 种</el-descriptions-item>
      </el-descriptions>
      <div class="receive-table-wrap">
        <el-table :data="receiveLines" size="small" border stripe style="width:100%">
          <el-table-column prop="sku" label="SKU" width="118" fixed="left" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono">{{ row.sku }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="商品名" min-width="160" show-overflow-tooltip />
          <el-table-column prop="spec" label="规格" width="88" show-overflow-tooltip>
            <template #default="{ row }">{{ row.spec || '—' }}</template>
          </el-table-column>
          <el-table-column label="采购/已收/待收" width="128" align="center">
            <template #default="{ row }">
              <span class="qty-cell">{{ row.quantity?.toLocaleString?.() ?? row.quantity }}</span>
              <span class="qty-sep">/</span>
              <span class="qty-cell muted">{{ row.receivedQty?.toLocaleString?.() ?? row.receivedQty }}</span>
              <span class="qty-sep">/</span>
              <strong class="qty-pending">{{ row.pendingQty.toLocaleString() }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="良品实收" width="120" align="center">
            <template #default="{ row }">
              <el-input-number
                v-model="row.actualQty"
                :min="0"
                :max="Math.max(0, row.pendingQty - (row.damagedQty || 0))"
                size="small"
                controls-position="right"
                class="receive-qty-input"
                @change="onActualChange(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="破损" width="112" align="center">
            <template #default="{ row }">
              <el-input-number
                v-model="row.damagedQty"
                :min="0"
                :max="row.pendingQty"
                size="small"
                controls-position="right"
                class="receive-qty-input"
                @change="onDamagedChange(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="QC" width="96" align="center">
            <template #default="{ row }">
              <el-select v-model="row.qcStatus" size="small" class="receive-qc-select">
                <el-option label="通过" value="pass" />
                <el-option label="异常" value="fail" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="QC 备注" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.qcRemark" size="small" placeholder="破损说明等" clearable />
            </template>
          </el-table-column>
        </el-table>
      </div>
      <el-input v-model="receiveRemark" type="textarea" :rows="2" placeholder="整单备注（可选）" class="receive-remark" />
    </template>
    <template #footer>
      <el-button @click="receiveVisible = false">取消</el-button>
      <el-button type="primary" @click="submitReceive">确认收货入仓</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; align-items:center; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.line-preview { display:flex; align-items:center; gap:6px; line-height:22px; flex-wrap:wrap; }
.line-name { max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:#64748b; }
.line-pending { color:#1f9d92; font-size:12px; white-space:nowrap; }
.receive-summary { margin-bottom: 12px; }
.receive-table-wrap { width:100%; overflow-x:auto; margin-bottom:12px; }
.receive-table-wrap :deep(.el-table) { min-width: 880px; }
.receive-qty-input { width: 100%; max-width: 108px; }
.receive-qty-input :deep(.el-input__wrapper) { padding-left: 8px; padding-right: 28px; }
.receive-qc-select { width: 100%; }
.receive-remark { margin-top: 4px; }
:deep(.receive-dialog) { max-width: 96vw; }
:deep(.receive-dialog .el-dialog__body) { padding-top: 12px; }
:deep(.el-table) { width: 100%; }
</style>
