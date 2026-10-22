<script setup lang="ts">
import { displaySku, displaySkuText } from '@erp/shared/sku-display'
import { userFacingError } from '@erp/shared/user-facing-error'
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { warehouseApi, inventoryApi, logisticsReceiptApi } from '@/api/client.js'
import { mapWarehouse, mapInventory, mapLogisticsReceipt } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'
import StockFillBar from '@/components/ui/StockFillBar.vue'
import { useAppStore } from '@/stores/app'
import { clearReceiptAttempt, readReceiptAttempts, saveReceiptAttempt, type ReceiptAttempt } from '@/utils/logisticsReceiptAttempt'

const { confirmAction, showDetail } = useRowActions()
const router = useRouter()
const route = useRoute()
const app = useAppStore()
const canReceive = computed(() => app.hasPerm('logistics_wh.receive'))
const canManage = computed(() => app.hasPerm('logistics_wh.manage'))
const canCreateInbound = computed(() => app.hasPerm('create_inbound.view') && app.hasPerm('create_inbound.create'))

const initialTab = String(route.query.tab || '')
const tab = ref(['stock', 'receipts', 'files'].includes(initialTab) ? initialTab : initialTab === 'pending' && canReceive.value ? 'pending' : 'manage')
const fromPo = computed(() => typeof route.query.fromPo === 'string' ? route.query.fromPo : '')
const stockWarehouse = ref(String(route.query.wh || 'all'))

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
const pendingError = ref('')
let pendingLoadVersion = 0

async function loadPendingPos() {
  if (!canReceive.value) return false
  const version = ++pendingLoadVersion
  pendingLoading.value = true
  pendingError.value = ''
  try {
    const res = await logisticsReceiptApi.listPendingPos({})
    if (version !== pendingLoadVersion) return false
    pendingPos.value = res || []
    return true
  } catch (error) {
    if (version === pendingLoadVersion) pendingError.value = `待收货列表未能刷新，请重新读取后操作。${userFacingError(error)}`
    return false
  } finally {
    if (version === pendingLoadVersion) pendingLoading.value = false
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
  refreshReceiptAttempts()
  if (tab.value === 'stock') loadStock()
  if (tab.value === 'receipts') loadReceipts()
  if (tab.value === 'files') loadFileConfigWarehouses()
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
const filteredPendingPos = computed(() => fromPo.value ? pendingPos.value.filter(row => row.poNo === fromPo.value) : pendingPos.value)
const { page: poPage, pageSize: poPageSize, total: poTotal, pagedItems: pagedPending } = useTablePagination(filteredPendingPos)
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
  totalVolumeCbm: null as number | null,
})

const outboundFileOptions = [
  { value: 'outerLabel', label: '外箱标签' },
  { value: 'skuLabel', label: 'SKU 标签' },
  { value: 'deliveryList', label: '送货清单' },
  { value: 'appointment', label: '预约文件' },
]

function openAddWarehouse() {
  whEditingId.value = null
  whForm.value = { warehouseCode: '', warehouseName: '', city: '', address: '', contactName: '', contactPhone: '', requiredOutboundFiles: [], totalVolumeCbm: null }
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
    totalVolumeCbm: row.totalVolumeCbm != null ? Number(row.totalVolumeCbm) : null,
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
        totalVolumeCbm: whForm.value.totalVolumeCbm,
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
        totalVolumeCbm: whForm.value.totalVolumeCbm,
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
const receiveLoading = ref(false)
const receiveBusy = ref(false)
const receiveUncertain = ref(false)
const receiveFeedback = ref('')
const receiveRequestId = ref('')
const receiveTargetId = ref<number | null>(null)
const receivePayload = ref<any>(null)
const receiveResult = ref<any>(null)
const receiptAttempts = ref<ReceiptAttempt[]>([])
const receiptAttemptError = ref('')

function refreshReceiptAttempts() {
  try { receiptAttempts.value = readReceiptAttempts(localStorage, app.authenticatedUser!.id); receiptAttemptError.value = '' }
  catch (error) { receiptAttemptError.value = userFacingError(error) }
}

function openReceiptRecovery(attempt: ReceiptAttempt) {
  if (receiveBusy.value) return
  receiveTargetId.value = attempt.payload.poId
  receiveTarget.value = JSON.parse(JSON.stringify(attempt.target))
  receiveLines.value = JSON.parse(JSON.stringify(attempt.lines))
  receivePayload.value = JSON.parse(JSON.stringify(attempt.payload))
  receiveRemark.value = String(attempt.payload.remark || '')
  receiveRequestId.value = attempt.payload.clientRequestId
  receiveUncertain.value = true
  receiveResult.value = null
  receiveFeedback.value = '上次收货结果待核对。输入已保留，核对并重试将使用同一次操作标识，避免重复入仓。'
  receiveVisible.value = true
}

async function openReceive(requested: any) {
  if (!canReceive.value || receiveBusy.value || receiptAttemptError.value) return
  refreshReceiptAttempts()
  const pendingAttempt = receiptAttempts.value.find(attempt => attempt.payload.poId === requested.id)
  if (pendingAttempt) { openReceiptRecovery(pendingAttempt); return }
  if (receiptAttemptError.value) return
  receiveVisible.value = true
  receiveLoading.value = true
  receiveTargetId.value = requested.id
  receiveTarget.value = null
  receiveLines.value = []
  receiveFeedback.value = ''
  receiveUncertain.value = false
  receivePayload.value = null
  receiveResult.value = null
  receiveRequestId.value = crypto.randomUUID()
  try {
    if (!await loadPendingPos()) { receiveFeedback.value = pendingError.value || '单据读取已更新，请重新读取'; return }
    if (!receiveVisible.value || receiveTargetId.value !== requested.id) return
    const row = pendingPos.value.find(po => po.id === requested.id)
    if (!row) { receiveFeedback.value = '该采购单已收齐或状态已变化，请查看收货记录核对结果'; return }
    if (row.receiptIssue) { receiveFeedback.value = row.receiptIssue; return }
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
  } finally { receiveLoading.value = false }
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

async function submitReceive(replay = false) {
  if (!receiveTarget.value || receiveBusy.value || receiveLoading.value || receiveResult.value || (!replay && receiveUncertain.value)) return
  receiveFeedback.value = ''
  const items = receiveLines.value.filter((l) => l.actualQty > 0 || l.damagedQty > 0)
  if (!replay && !items.length) { receiveFeedback.value = '请填写良品实收或破损数量'; return }
  for (const l of items) {
    if (![l.actualQty, l.damagedQty].every(qty => Number.isSafeInteger(Number(qty)) && Number(qty) >= 0 && Number(qty) <= 2147483647)) { receiveFeedback.value = '良品实收和破损数量须为非负整数'; return }
    if (l.actualQty + l.damagedQty > l.pendingQty) {
      receiveFeedback.value = displaySkuText(`${displaySku(l)} 良品与破损合计超过待收 ${l.pendingQty}`)
      return
    }
  }
  receiveBusy.value = true
  let sent = false
  try {
    const payload = replay ? receivePayload.value : {
      poId: receiveTarget.value.id,
      warehouseCode: receiveTarget.value.warehouseCode,
      remark: receiveRemark.value,
      clientRequestId: receiveRequestId.value,
      items: items.map((l) => ({
        poItemId: l.id,
        sku: l.sku,
        actualQty: l.actualQty,
        damagedQty: l.damagedQty || 0,
        qcStatus: l.qcStatus,
        qcRemark: l.qcRemark || undefined,
      })),
    }
    if (!payload) throw new Error('本次收货核对信息缺失，请重新读取单据')
    // Persist before sending so reload and return-to-list keep the same idempotency key.
    saveReceiptAttempt(localStorage, app.authenticatedUser!.id, { payload, target: receiveTarget.value, lines: receiveLines.value })
    receivePayload.value = JSON.parse(JSON.stringify(payload))
    sent = true
    const result = await logisticsReceiptApi.create(payload)
    receiveResult.value = result
    receiveUncertain.value = false
    receiveFeedback.value = `${result.duplicate ? '已核对原收货记录' : '本次收货已确认'}：${result.receiptNo}。${result.poStatus === 'received' ? '采购单已收齐，良品已入中转仓库存' : '仍有待收数量，可返回列表继续收货'}。破损件单独记录，不增加可用库存。`
    try { clearReceiptAttempt(localStorage, app.authenticatedUser!.id, payload.poId) } catch { receiveFeedback.value += ' 本地核对信息暂未清除，可使用原操作标识再次核对。' }
    refreshReceiptAttempts()
    await loadPendingPos()
    void loadStock()
    void loadReceipts()
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status)
    receiveUncertain.value = (sent || replay) && !(status >= 400 && status < 500 && status !== 408 && status !== 409)
    receiveFeedback.value = receiveUncertain.value ? `收货结果暂无法确定，请核对并重试本次收货。${userFacingError(error)}` : userFacingError(error)
    if (!receiveUncertain.value && receivePayload.value) { try { clearReceiptAttempt(localStorage, app.authenticatedUser!.id, receiveTarget.value.id) } catch { /* retain safe replay metadata */ } }
    refreshReceiptAttempts()
  } finally { receiveBusy.value = false }
}

function receiptDetail(row: any) {
  showDetail(`收货记录 · ${row.receiptNo}`, [
    ['收货单号', row.receiptNo], ['采购单', row.poNo], ['仓库', row.warehouseCode],
    ['操作人', row.operatorName], ['收货时间', row.receivedAt],
    ['备注', row.remark || '—'],
    ['SKU 明细', row.items.map((i: any) => {
      const dmg = i.damagedQty ? ` 破损${i.damagedQty}` : ''
      const qc = i.qcStatus === 'fail' ? ' [质检异常]' : ''
      return `${i.sku} ${i.productName} 良品×${i.actualQty}${dmg}${qc}${i.qcRemark ? ` (${i.qcRemark})` : ''}`
    }).join('\n')],
  ])
}

function showReceiptNext(next: 'stock' | 'receipts') {
  if (receiveBusy.value) return
  stockWarehouse.value = receiveTarget.value?.warehouseCode || 'all'
  receiveVisible.value = false
  tab.value = next
}

const warehouseOptions = computed(() => warehouses.value.filter(w => w.statusCode === 1))

function goCreateInbound(row?: any) {
  const q: Record<string, string> = {}
  if (row?.warehouse) q.wh = row.warehouse
  if (row?.sku) q.sku = row.sku
  router.push({ path: '/inbound/create', query: q })
}
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
          <el-button v-if="tab === 'stock'" size="small" @click="router.push('/logistics-inventory')">完整库存页</el-button>
          <el-button v-if="tab === 'stock' && canCreateInbound" type="primary" size="small" @click="goCreateInbound()">创建入库单</el-button>
          <el-button v-if="tab === 'manage' && canManage" type="primary" size="small" @click="openAddWarehouse">添加物流仓库</el-button>
        </div>
      </div>
    </template>

    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="中转仓管理" name="manage" />
      <el-tab-pane v-if="canReceive" label="待收货采购单" name="pending" />
      <el-tab-pane label="中转仓库存" name="stock" />
      <el-tab-pane label="收货记录" name="receipts" />
      <el-tab-pane label="出库文件配置" name="files" />
    </el-tabs>

    <el-alert v-if="receiptAttemptError" :title="receiptAttemptError" type="warning" :closable="false" role="alert" style="margin-bottom:12px" />
    <div v-if="canReceive && receiptAttempts.length" style="margin-bottom:12px">
      <p>有收货结果尚待核对。请先核对原操作，避免重复登记。</p>
      <el-button v-for="attempt in receiptAttempts" :key="attempt.payload.clientRequestId" :disabled="receiveBusy" @click="openReceiptRecovery(attempt)">核对收货 · {{ attempt.target.poNo }}</el-button>
    </div>

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
        <el-table-column label="总库容 m³" width="110">
          <template #default="{ row }">{{ row.totalVolumeCbm != null ? row.totalVolumeCbm : '未设置' }}</template>
        </el-table-column>
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
            <el-button v-if="canManage" link type="primary" size="small" @click="openEditWarehouse(row)">编辑</el-button>
            <el-button v-if="canManage" link :type="row.statusCode === 1 ? 'warning' : 'success'" size="small" @click="toggleWarehouseStatus(row)">
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
        <el-table-column label="总库容 m³" width="110">
          <template #default="{ row }">{{ row.totalVolumeCbm != null ? row.totalVolumeCbm : '未设置' }}</template>
        </el-table-column>
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
            <el-button v-if="canManage" link type="primary" size="small" @click="openEditWarehouse(row)">配置</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 待收货 PO -->
    <template v-if="tab === 'pending'">
      <div v-if="fromPo" style="margin-bottom:12px">
        <p>当前采购单：{{ fromPo }}。可登记本次到货数量，确认收货后增加中转仓库存。</p>
        <el-button @click="router.push({ path: '/purchase', query: { poNo: fromPo } })">返回采购订单</el-button>
        <el-button @click="router.replace({ path: '/logistics-wh', query: { tab: 'pending' } })">查看全部待收货</el-button>
      </div>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
        采购审核通过的采购单，供应商送货至<strong>物流中转仓</strong>后在此登记收货。良品与破损均计入已收数量，只有良品增加可用库存；破损件单独留档。
      </el-alert>
      <el-alert v-if="pendingError" :title="pendingError" type="warning" :closable="false" role="alert" style="margin-bottom:12px" />
      <div style="margin-bottom:12px">
        <el-button :loading="pendingLoading" :disabled="receiveBusy" @click="loadPendingPos">重新读取待收货</el-button>
        <el-button @click="tab = 'receipts'">查看收货记录</el-button>
        <el-button @click="tab = 'stock'">查看中转仓库存</el-button>
      </div>
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
              <span class="mono">{{ displaySku(item) }}</span>
              <span v-if="item.name" class="line-name" :title="item.name">{{ item.name }}</span>
              <span class="line-pending">× {{ item.pendingQty.toLocaleString() }}</span>
            </div>
            <span v-if="row.receiptIssue" style="color:var(--el-color-danger)">{{ row.receiptIssue }}</span>
          </template>
        </el-table-column>
        <el-table-column label="金额 (RMB)" width="120" align="right">
          <template #default="{ row }">¥ {{ row.amount.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="expectedArrival" label="预计到货" width="100" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canReceive" type="primary" size="small" link :disabled="pendingLoading || receiveBusy || Boolean(pendingError) || Boolean(row.receiptIssue) || Boolean(receiptAttemptError)" @click="openReceive(row)">登记收货</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="poPage" v-model:page-size="poPageSize" :total="poTotal" />
    </template>

    <!-- 仓库库存 -->
    <template v-if="tab === 'stock'">
      <p class="stock-hint">已收货在库。可发数量用于创建海外入库单，发运后从这里扣减。</p>
      <el-table v-loading="stockLoading" :data="pagedStock" border stripe size="small" class="stock-table" empty-text="该仓库暂无到货库存" header-cell-class-name="stock-table-header">
        <el-table-column label="SKU / 商品" min-width="200">
          <template #default="{ row }">
            <div class="mono sku">{{ displaySku(row) }}</div>
            <div class="title-cn">{{ row.name || '—' }}</div>
            <div v-if="row.spec" class="title-en">{{ row.spec }}</div>
          </template>
        </el-table-column>
        <el-table-column label="中转仓" width="128">
          <template #default="{ row }">
            <div>{{ row.warehouseName || row.warehouse }}</div>
            <div class="title-en">{{ row.warehouse }}</div>
          </template>
        </el-table-column>
        <el-table-column label="库存构成" min-width="150">
          <template #default="{ row }">
            <StockFillBar :available="row.available" :locked="row.locked" :total="row.total" />
          </template>
        </el-table-column>
        <el-table-column label="库存数量" align="center">
          <el-table-column label="在库" width="80" align="right">
            <template #default="{ row }"><span class="qty-num">{{ row.total.toLocaleString() }}</span></template>
          </el-table-column>
          <el-table-column label="可发" width="80" align="right">
            <template #default="{ row }">
              <strong class="qty-num" :class="{ ready: row.available > 0 }">{{ row.available.toLocaleString() }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="锁定" width="68" align="right">
            <template #default="{ row }">
              <span class="qty-num" :class="{ locked: row.locked > 0 }">{{ row.locked.toLocaleString() }}</span>
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="最近变动" width="140">
          <template #default="{ row }">
            <div>{{ row.lastInboundDate || '—' }}</div>
            <div class="title-en">{{ row.referenceNo || '无关联单' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="88" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.available > 0 && canCreateInbound" link type="primary" size="small" @click="goCreateInbound(row)">发运</el-button>
            <span v-else class="title-en">不可发</span>
          </template>
        </el-table-column>
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
        <el-table-column label="良品" width="70" align="right">
          <template #default="{ row }">{{ row.goodQty.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="破损" width="70" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.damagedQty > 0 ? '#e85d5d' : '#8b95a8' }">{{ row.damagedQty || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="质检" width="70" align="center">
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
      <el-form-item label="总库容 m³">
        <el-input-number v-model="whForm.totalVolumeCbm" :min="0" :precision="4" :step="10" controls-position="right" style="width:100%" />
        <div style="color:#8b95a8;font-size:12px;line-height:18px">仓级上限，容量预警按此计算，不按库位加总。</div>
      </el-form-item>
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
    :close-on-click-modal="!receiveBusy"
    :close-on-press-escape="!receiveBusy"
    :show-close="!receiveBusy"
  >
    <el-alert v-if="receiveFeedback" :title="receiveFeedback" :type="receiveResult ? 'success' : 'warning'" :closable="false" role="alert" style="margin-bottom:12px" />
    <el-button v-if="!receiveTarget && !receiveLoading && receiveTargetId" @click="openReceive({ id: receiveTargetId })">重新读取单据</el-button>
    <div v-loading="receiveLoading" style="min-height:80px">
    <template v-if="receiveTarget">
      <el-text>良品与破损计入采购单已收数量，破损不进入可用库存。可分批登记实际到货。</el-text>
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
              <span class="mono">{{ displaySku(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="商品名" min-width="160" show-overflow-tooltip />
          <el-table-column prop="spec" label="规格" width="88" show-overflow-tooltip>
            <template #default="{ row }">{{ row.spec || '—' }}</template>
          </el-table-column>
          <el-table-column :label="receiveResult || receiveUncertain ? '提交前采购/已收/待收' : '采购/已收(含破损)/待收'" width="155" align="center">
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
                :aria-label="`${row.sku} 良品实收`"
                :disabled="receiveBusy || receiveUncertain || Boolean(receiveResult)"
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
                :aria-label="`${row.sku} 破损数量`"
                :disabled="receiveBusy || receiveUncertain || Boolean(receiveResult)"
                :min="0"
                :max="row.pendingQty"
                size="small"
                controls-position="right"
                class="receive-qty-input"
                @change="onDamagedChange(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="质检" width="96" align="center">
            <template #default="{ row }">
              <el-select v-model="row.qcStatus" :aria-label="`${row.sku} 质检结论`" :disabled="receiveBusy || receiveUncertain || Boolean(receiveResult) || row.damagedQty > 0" size="small" class="receive-qc-select">
                <el-option label="通过" value="pass" />
                <el-option label="异常" value="fail" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="质检备注" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.qcRemark" :disabled="receiveBusy || receiveUncertain || Boolean(receiveResult)" size="small" placeholder="破损说明等" clearable />
            </template>
          </el-table-column>
        </el-table>
      </div>
      <el-input v-model="receiveRemark" :disabled="receiveBusy || receiveUncertain || Boolean(receiveResult)" type="textarea" :rows="2" placeholder="整单备注（可选）" class="receive-remark" />
    </template>
    </div>
    <template #footer>
      <el-button :disabled="receiveBusy" @click="receiveVisible = false">返回列表</el-button>
      <template v-if="receiveResult">
        <el-button v-if="receiveResult.poStatus !== 'received'" type="primary" :disabled="receiveBusy" @click="openReceive({ id: receiveTarget.id })">继续本单收货</el-button>
        <el-button @click="showReceiptNext('receipts')">查看收货记录</el-button>
        <el-button type="primary" @click="showReceiptNext('stock')">查看中转仓库存</el-button>
      </template>
      <el-button v-else-if="receiveUncertain" type="primary" :loading="receiveBusy" @click="submitReceive(true)">核对并重试本次收货</el-button>
      <el-button v-else type="primary" :loading="receiveBusy" :disabled="receiveLoading || !receiveTarget" @click="submitReceive()">确认收货入仓</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; align-items:center; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.sku { font-weight: 600; color: var(--el-color-primary); }
.stock-hint { margin: 0 0 12px; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.stock-table { width: 100%; }
.stock-table :deep(.stock-table-header) {
  background: var(--table-header-bg) !important;
  color: var(--table-header-text);
  font-weight: 600;
}
.title-cn { margin-top: 2px; line-height: 1.4; }
.title-en { margin-top: 2px; color: var(--text-muted); font-size: 11px; }
.qty-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.qty-num.ready { color: #0f766e; }
.qty-num.locked { color: #b45309; }
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
