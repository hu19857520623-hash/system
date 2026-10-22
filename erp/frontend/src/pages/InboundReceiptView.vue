<script setup lang="ts">
import { userFacingError } from '@erp/shared/user-facing-error'

import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { inboundApi } from '@/api/client.js'
import { mapInbound, fmtTime } from '@/api/mappers.ts'
import { withAction } from '@/composables/useListLoader.ts'
import { useAppStore } from '@/stores/app'
import { INBOUND_STATUS } from '@/constants/index.js'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'
import { inboundCustomerSku } from '@erp/shared/inbound-customer-sku'
import WarehouseControlDialog from '@/components/inbound/WarehouseControlDialog.vue'
import { warehouseControlOptions, type WarehouseControlKind } from '@/utils/warehouseControl'
import { MANUAL_ARRIVAL_STATUSES, recordedReceivedCartonCount } from '@/utils/manual-inbound-receive'
import { readWarehouseAttempts, saveWarehouseAttempt, clearWarehouseAttempt, runWarehouseAttempt, recoverWarehouseAttemptFailure, type WarehouseAttempt } from '@/utils/warehouseOperation'

function bound990Text(row: any): string {
  const codes = [
    row?.platformBarcode,
    ...(Array.isArray(row?.platformBarcodes) ? row.platformBarcodes : []),
    row?.barcode,
  ]
    .map((c: any) => String(c || '').trim())
    .filter((c: string) => /^990\d+/i.test(c))
  const unique = [...new Set(codes)]
  if (!unique.length) return ''
  return unique.length === 1 ? unique[0] : `${unique[0]} 等${unique.length}个`
}

const app = useAppStore()
const route = useRoute()
const router = useRouter()
const warehouseAttempts = ref<WarehouseAttempt[]>([])
const warehouseStorageError = ref('')
const warehouseBusy = ref(false)
const warehouseNotice = ref('')
function readPendingOperations() {
  try { warehouseAttempts.value = readWarehouseAttempts(localStorage, Number(app.authenticatedUser?.id)); warehouseStorageError.value = '' }
  catch (error) { warehouseStorageError.value = userFacingError(error) }
}
function hasPendingOperation(id: number) { return warehouseAttempts.value.some(row => row.inboundId === Number(id)) }
async function retryWarehouseOperation(attempt: WarehouseAttempt) {
  if (warehouseBusy.value) return false
  warehouseBusy.value = true
  const operatorId = Number(app.authenticatedUser?.id)
  let result: any
  try {
    result = await runWarehouseAttempt(inboundApi, attempt)
    if (result.feePending || result.syncPending) {
      warehouseNotice.value = result.warning || '作业已保存，费用待核对，请使用原操作重试'
      ElMessage.warning(warehouseNotice.value)
      return false
    }
    clearWarehouseAttempt(localStorage, operatorId, attempt)
    readPendingOperations()
    warehouseNotice.value = result.message || '原仓库操作已完成，请继续查看单据进度'
    manualReceiveVisible.value = false; qcDialogVisible.value = false
    ElMessage.success(warehouseNotice.value)
  } catch (error: any) {
    const recovery = recoverWarehouseAttemptFailure(localStorage, operatorId, attempt, error)
    readPendingOperations()
    if (!recovery.retained) { manualReceiveVisible.value = false; qcDialogVisible.value = false }
    warehouseNotice.value = recovery.message
    ElMessage.error(warehouseNotice.value)
    return false
  } finally { warehouseBusy.value = false }
  await reloadAll()
  return true
}
async function submitWarehouseOperation(kind: WarehouseAttempt['kind'], order: any, payload: Record<string, any>) {
  if (warehouseBusy.value || warehouseStorageError.value || hasPendingOperation(order.id)) return false
  const attempt: WarehouseAttempt = JSON.parse(JSON.stringify({ kind, inboundId: Number(order.id), inboundNo: order.inboundNo,
    warehouseCode: order.warehouseCode, payload: { ...payload, clientRequestId: crypto.randomUUID() }, snapshot: { order } }))
  try { saveWarehouseAttempt(localStorage, Number(app.authenticatedUser?.id), attempt); readPendingOperations() }
  catch (error) { warehouseStorageError.value = userFacingError(error); ElMessage.error(warehouseStorageError.value); return false }
  return retryWarehouseOperation(attempt)
}
function continueWarehouseOperation(attempt: WarehouseAttempt) {
  void router.push({ name: 'InboundArrivalScan', query: { inboundId: String(attempt.inboundId) } })
}

type StatusFilter = 'all' | 'in_transit' | 'arrived' | 'receiving' | 'putaway' | 'completed' | 'exception' | 'cancelled'

const filter = ref<StatusFilter>('all')
const searchQ = ref('')
const page = ref(1)
const pageSize = ref(50)
const listTotal = ref(0)
const loading = ref(false)
const inboundOrders = ref<any[]>([])
const listReadError = ref('')
const countsReadError = ref('')
let listReadVersion = 0, countsReadVersion = 0

const statusCounts = ref({
  all: 0,
  in_transit: 0,
  arrived: 0,
  receiving: 0,
  putaway: 0,
  completed: 0,
  exception: 0,
  cancelled: 0,
})

const STATUS_FILTER_QUERY: Record<Exclude<StatusFilter, 'all'>, string> = {
  in_transit: 'pending_receipt',
  arrived: 'arrived',
  receiving: 'receiving',
  putaway: 'pending_putaway',
  completed: 'completed',
  exception: 'exception',
  cancelled: 'cancelled',
}

/** 从入库备注中剥离入仓号/到货日等系统元数据，得到客户填写备注 */
function parseCustomerRemark(remark?: string | null) {
  const raw = remark || ''
  const userRemark = raw
    .replace(/\[.*?\]/g, '')
    .replace(/入仓:[^\s]+/g, '')
    .replace(/到货:\d{4}-\d{2}-\d{2}/g, '')
    .replace(/海运:[^\s]+/g, '')
    .replace(/承运:[^\s]+/g, '')
    .replace(/运单:[^\s]+/g, '')
    .trim()
  return userRemark
}

function qcStatusLabel(status?: string | null) {
  if (status === 'pass') return '通过'
  if (status === 'fail') return '异常'
  if (status === 'pending') return '待检'
  return status ? '待核对' : '—'
}

const filterTabs = computed(() => [
  { value: 'all' as const, label: '全部', count: statusCounts.value.all },
  { value: 'in_transit' as const, label: '在途', count: statusCounts.value.in_transit },
  { value: 'arrived' as const, label: '已到仓', count: statusCounts.value.arrived },
  { value: 'receiving' as const, label: '收货中', count: statusCounts.value.receiving },
  { value: 'putaway' as const, label: '待上架', count: statusCounts.value.putaway },
  { value: 'completed' as const, label: '已入库', count: statusCounts.value.completed },
  { value: 'exception' as const, label: '异常', count: statusCounts.value.exception },
  { value: 'cancelled' as const, label: '作废', count: statusCounts.value.cancelled },
])

function statusTagType(status: string, displayStatus?: string) {
  const key = displayStatus || status
  if (key === 'exception') return 'danger'
  if (key === 'arrived') return 'warning'
  if (key === 'receiving') return 'warning'
  if (key === 'pending_putaway') return 'warning'
  if (key === 'completed') return 'success'
  return 'info'
}

const orderRows = computed(() =>
  inboundOrders.value.map((o) => {
    const raw = o._raw
    const qty = (raw.items || []).reduce((s: number, i: any) => s + (i.expectedQty || 0), 0)
    const skuLabel = raw.items?.length === 1
      ? inboundCustomerSku(raw.items[0], raw.omsCustomerCode)
      : raw.items?.length ? `${inboundCustomerSku(raw.items[0], raw.omsCustomerCode)} 等 ${raw.items.length} SKU` : '—'
    const displayStatus = raw.displayStatus || raw.status
    const customerRemark = parseCustomerRemark(raw.remark)
    return {
      id: raw.id,
      inboundNo: raw.inboundNo,
      warehouse: raw.warehouseCode,
      warehouseNo: raw.warehouseNo || '',
      sku: skuLabel,
      qty,
      customerCode: raw.omsCustomerCode || '',
      dataSource: raw.dataSource || 'erp',
      dataSourceLabel: raw.dataSourceLabel || 'ERP',
      readOnly: Boolean(raw.readOnly),
      customerRemark: customerRemark || '—',
      poRemark: raw.poRemark || '',
      status: raw.status,
      displayStatus,
      statusLabel: INBOUND_STATUS[displayStatus]?.label || '待核对',
      itemCount: raw.items?.length || 0,
      createdAt: fmtTime(raw.createdAt),
      _raw: raw,
    }
  }),
)

async function refreshCounts() {
  const version = ++countsReadVersion, keyword = searchQ.value.trim()
  countsReadError.value = ''
  const entries: [keyof typeof statusCounts.value, string | undefined][] = [
    ['all', undefined],
    ['in_transit', 'pending_receipt'],
    ['arrived', 'arrived'],
    ['receiving', 'receiving'],
    ['putaway', 'pending_putaway'],
    ['completed', 'completed'],
    ['exception', 'exception'],
    ['cancelled', 'cancelled'],
  ]
  try {
    const results = await Promise.all(
      entries.map(([, status]) => inboundApi.list({ pageSize: 1, ...(keyword ? { keyword } : {}), ...(status ? { status } : {}) })),
    )
    if (version !== countsReadVersion) return
    entries.forEach(([key], i) => {
      statusCounts.value[key] = results[i]?.total ?? 0
    })
  } catch (error) {
    if (version === countsReadVersion) countsReadError.value = `状态数量未能刷新，请重试后核对。${userFacingError(error)}`
  }
}

async function load() {
  const version = ++listReadVersion
  listReadError.value = ''
  loading.value = true
  try {
    const params: Record<string, unknown> = { page: page.value, pageSize: pageSize.value }
    if (filter.value !== 'all') {
      params.status = STATUS_FILTER_QUERY[filter.value]
    }
    const q = searchQ.value.trim()
    if (q) params.keyword = q
    const res = await inboundApi.list(params)
    if (version !== listReadVersion) return
    inboundOrders.value = (res.items || []).map((r: any) => ({ ...mapInbound(r), _raw: r }))
    listTotal.value = res.total ?? inboundOrders.value.length
  } catch (e: any) {
    if (version === listReadVersion) listReadError.value = `列表未能刷新，请重新读取。${userFacingError(e)}`
  } finally {
    if (version === listReadVersion) loading.value = false
  }
}

async function reloadAll() {
  await Promise.all([load(), refreshCounts()])
}

watch([filter, page, pageSize], () => load())
watch(searchQ, () => {
  page.value = 1
  void reloadAll()
})
watch(filter, () => {
  page.value = 1
})

const canReceive = computed(() => app.hasPerm('inbound.receive'))
const canConfirmArrival = computed(() => app.hasPerm('inbound.arrival_scan'))
const manualReceiveVisible = ref(false)
const manualReceiveLoading = ref(false)
const manualReceiveSubmitting = ref(false)
const manualReceiveOrder = ref<any>(null)
const manualReceiveCount = ref<number | null>(null)
const manualReceiveReason = ref('')

function canManualReceiveOrder(row: any) {
  if (!row || row.readOnly || String(row.id).startsWith('oms-') || !canReceive.value || warehouseBusy.value || warehouseStorageError.value || hasPendingOperation(row.id)) return false
  return ['arrived', 'receiving'].includes(row.status)
    || (canConfirmArrival.value && MANUAL_ARRIVAL_STATUSES.includes(row.status))
}

async function openManualReceive(row: any) {
  if (!canManualReceiveOrder(row)) return
  detailVisible.value = false
  manualReceiveOrder.value = null
  manualReceiveCount.value = null
  manualReceiveReason.value = ''
  manualReceiveVisible.value = true
  manualReceiveLoading.value = true
  try {
    const order = await inboundApi.detail(row.id)
    if (!canManualReceiveOrder(order)) throw new Error('当前单据不可手动收货，请刷新列表查看状态')
    manualReceiveOrder.value = order
    manualReceiveCount.value = recordedReceivedCartonCount(order)
  } catch (e: any) {
    ElMessage.error(userFacingError(e?.message || '加载收货单据失败'))
    manualReceiveVisible.value = false
  } finally {
    manualReceiveLoading.value = false
  }
}

async function submitManualReceive() {
  const order = manualReceiveOrder.value
  if (!canManualReceiveOrder(order) || manualReceiveSubmitting.value) return
  const count = Number(manualReceiveCount.value)
  if (!Number.isSafeInteger(count) || count <= 0 || count > 9999) { ElMessage.warning('请填写有效的实收箱数整数'); return }
  if (order.cartons?.length && count !== order.cartons.length && manualReceiveReason.value.trim().length < 2) { ElMessage.warning('箱数与应收不一致，请填写不少于两个字的差异原因'); return }
  manualReceiveSubmitting.value = true
  try {
    const ok = await submitWarehouseOperation('carton-count', order, { receivedCartonCount: count, differenceReason: manualReceiveReason.value.trim() })
    if (ok && canQc.value) {
      await router.push({ name: 'InboundArrivalScan', query: { inboundId: String(order.id), step: 'qc' } })
    }
  } catch (e: any) {
    ElMessage.error(userFacingError(e?.message || '手动收货失败'))
  } finally {
    manualReceiveSubmitting.value = false
  }
}
const canPutaway = computed(() => app.hasPerm('inbound.putaway'))

function canPutawayOrder(row: any) {
  return canPutaway.value && row?.status === 'pending_putaway'
    && !row.readOnly && !String(row.id).startsWith('oms-')
    && row.displayStatus !== 'exception'
}

function openPutaway(row: any) {
  if (!canPutawayOrder(row)) return
  detailVisible.value = false
  void router.push({ name: 'InboundArrivalScan', query: { inboundId: String(row.id), step: 'putaway' } })
}

const canPrintSku = computed(() => app.hasPerm('create_inbound.label'))
const printingSkuId = ref<number | string | null>(null)

async function printSkuLabels(row: any) {
  const id = row?._raw?.id ?? row?.id
  if (!id || row.readOnly || String(id).startsWith('oms-') || printingSkuId.value != null) return
  const printWindow = window.open('', '_blank')
  if (!printWindow) return ElMessage.warning('请允许弹窗后再打印 SKU 标签')
  printWindow.document.body.textContent = '正在生成 SKU 标签…'
  printingSkuId.value = id
  try {
    const { blob } = await inboundApi.downloadSkuLabel(id)
    const url = URL.createObjectURL(blob)
    printWindow.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000)
    ElMessage.success('已打开 SKU 标签 PDF，请在预览窗口打印')
  } catch (e: any) {
    printWindow.close()
    ElMessage.error(userFacingError(e?.message || '生成 SKU 标签失败'))
  } finally {
    printingSkuId.value = null
  }
}
const canQc = computed(() => app.hasPerm('inbound.qc'))
const countManaging = computed(() => warehouseBusy.value)
function countManageable(row: any) {
  const raw = row?._raw || row
  return raw && !raw.readOnly && !String(raw.id).startsWith('oms-') && raw.items?.length
    && !raw.items.some((i: any) => Number(i.putawayQty || 0) > 0)
}
function allCountedZero(row: any) {
  const raw = row?._raw || row
  return countManageable(row) && raw.items.every((i: any) => i.actualQty != null && Number(i.actualQty) === 0)
}
function canReopenCount(row: any) {
  return canQc.value && countManageable(row) && (['pending_putaway', 'exception'].includes(row.status) || (row.status === 'completed' && allCountedZero(row)))
}
function canCloseZero(row: any) {
  return (app.hasPerm('inbound.handle_exception') || app.hasPerm('inbound.confirm_diff')) && allCountedZero(row) && ['pending_putaway', 'exception'].includes(row.status)
}
const controlVisible = ref(false)
const controlInboundId = ref<number | null>(null)
const controlKind = ref<WarehouseControlKind>('reopen-count')
const controlAttempt = computed(() => warehouseAttempts.value.find(attempt => attempt.inboundId === controlInboundId.value) || null)
function openControl(row: any, kind?: WarehouseControlKind) {
  if (warehouseBusy.value || warehouseStorageError.value || hasPendingOperation(row.id)) return
  warehouseNotice.value = ''; controlInboundId.value = Number(row.id)
  controlKind.value = kind || warehouseControlOptions(row._raw || row, permission => app.hasPerm(permission)).find(kind => kind.startsWith('reduce-')) || 'reopen-count'
  controlVisible.value = true
}
function manageCount(row: any, mode: 'reopen' | 'close-zero') {
  if (mode === 'reopen' ? canReopenCount(row) : canCloseZero(row)) openControl(row, mode === 'reopen' ? 'reopen-count' : 'close-zero')
}
function hasQuantityControl(row: any) { return warehouseControlOptions(row._raw || row, permission => app.hasPerm(permission)).some(kind => kind.startsWith('reduce-')) }
async function submitControl(data: { kind: WarehouseControlKind; order: any; payload: any }) {
  return submitWarehouseOperation(data.kind, data.order, data.payload)
}
async function retryControl(id: number) {
  const attempt = warehouseAttempts.value.find(row => row.inboundId === id)
  return attempt ? retryWarehouseOperation(attempt) : false
}

const canResolve = computed(() => ['inbound.qc', 'inbound.putaway', 'inbound.handle_exception', 'inbound.confirm_diff'].some(permission => app.hasPerm(permission)))

const qcDialogVisible = ref(false)
const qcOrder = ref<any>(null)
const qcLines = ref<{
  id: number
  sku: string
  customerSku: string
  productName: string
  spec: string
  expectedQty: number
  actualQty: number
  qcStatus: string
  qcRemark: string
  lineRemark: string
}[]>([])
const qcAcceptDiff = ref(false)
const qcLoading = ref(false)

const qcCustomerRemark = computed(() => parseCustomerRemark(qcOrder.value?.remark) || '—')
const qcExpectedTotal = computed(() =>
  qcLines.value.reduce((sum, l) => sum + (l.expectedQty || 0), 0),
)
const qcActualTotal = computed(() =>
  qcLines.value.reduce((sum, l) => sum + (l.actualQty || 0), 0),
)

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailOrder = ref<any>(null)

const detailCustomerRemark = computed(() => parseCustomerRemark(detailOrder.value?.remark) || '—')
const detailStatusLabel = computed(() => {
  const o = detailOrder.value
  if (!o) return '—'
  const key = o.displayStatus || o.status
  return INBOUND_STATUS[key]?.label || o.status || '—'
})

async function openDetail(row: any) {
  detailVisible.value = true
  detailLoading.value = true
  detailOrder.value = null
  try {
    if (row.readOnly || row._raw?.readOnly || String(row.id).startsWith('oms-')) {
      detailOrder.value = row._raw || row
    } else {
      const data = await inboundApi.detail(row.id)
      detailOrder.value = data
    }
  } catch (e: any) {
    ElMessage.error(userFacingError(e?.message || '加载详情失败'))
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

async function downloadOmsAttachment(inboundId: number, attachmentId: number, fileName: string) {
  try {
    const { blob, fileName: fn } = await inboundApi.downloadOmsAttachment(inboundId, attachmentId)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fn || fileName || 'attachment'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e: any) {
    ElMessage.error(userFacingError(e?.message || '下载失败'))
  }
}

async function downloadReceivingList(row: any) {
  const id = row?._raw?.id ?? row?.id
  if (!id || row.readOnly || String(id).startsWith('oms-')) {
    ElMessage.warning('该入库单尚未同步到 ERP，暂不能下载清单')
    return
  }
  try {
    await inboundApi.downloadReceivingList(id)
  } catch (e: any) {
    ElMessage.error(userFacingError(e?.message || '下载入库清单失败'))
  }
}

async function openQc(row: any) {
  if (warehouseBusy.value || warehouseStorageError.value || hasPendingOperation(row.id)) { ElMessage.warning('请先在页面上方核对原仓库操作'); return }
  qcDialogVisible.value = true
  qcAcceptDiff.value = false
  qcOrder.value = row._raw
  qcLines.value = []
  qcLoading.value = true
  try {
    const data = await inboundApi.detail(row.id)
    if (!data.cartonConfirmation?.ready) {
      qcDialogVisible.value = false
      ElMessage.info(data.cartonConfirmation?.message || '请先完成收箱，再继续清点')
      await router.push({ name: 'InboundArrivalScan', query: { inboundId: String(row.id), step: 'receive' } })
      return
    }
    qcOrder.value = data
    qcLines.value = (data.items || []).map((item: any) => ({
      id: item.id,
      sku: item.sku,
      customerSku: inboundCustomerSku(item, data.omsCustomerCode),
      barcode: item.barcode || '',
      platformBarcode: item.platformBarcode || '',
      platformBarcodes: item.platformBarcodes || [],
      productName: item.productName || item.sku,
      spec: item.spec || '',
      expectedQty: item.expectedQty,
      actualQty: item.actualQty ?? 0,
      qcStatus: item.qcStatus === 'fail' ? 'fail' : 'pass',
      qcRemark: item.qcRemark || '',
      lineRemark: item.remark || '',
    }))
  } catch (e: any) {
    ElMessage.error(userFacingError(e?.message || '加载清点明细失败'))
    qcDialogVisible.value = false
  } finally {
    qcLoading.value = false
  }
}

async function startReceive(row: any) {
  if (!canReceive.value || warehouseBusy.value || hasPendingOperation(row.id)) return
  const ok = await withAction(async () => {
    await inboundApi.startReceive(row.id)
    await reloadAll()
  }, `${row.inboundNo} 已开始收货`)
  if (ok && canQc.value) {
    const fresh = inboundOrders.value.find((o) => o.id === row.id || o._raw?.id === row.id)
    await openQc(fresh ? { id: row.id, _raw: fresh._raw || fresh } : row)
  }
}

async function submitQc() {
  if (!qcOrder.value || !canQc.value || qcLoading.value || warehouseBusy.value) return
  if (qcLines.value.some(line => !Number.isSafeInteger(Number(line.actualQty)) || Number(line.actualQty) < 0)) { ElMessage.warning('各SKU实收数量须为不小于零的整数'); return }
  await submitWarehouseOperation('qc-submit', qcOrder.value, {
      expectedVersion: qcOrder.value.receivingVersion,
      acceptDiff: qcAcceptDiff.value,
      items: qcLines.value.map((l) => ({
        id: Number(l.id),
        sku: l.sku,
        actualQty: Number(l.actualQty),
        qcStatus: l.qcStatus,
        qcRemark: l.qcRemark || undefined,
      })),
    })
}

function resolveException(row: any) {
  if (canResolve.value) openControl(row, 'resolve-exception')
}

onMounted(async () => {
  readPendingOperations()
  await reloadAll()
  const inboundId = Number(route.query.inboundId)
  if (inboundId > 0) {
    await openDetail({ id: inboundId })
  }
})
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">入库单管理</span>
        <span v-if="statusCounts.all" class="page-meta">共 {{ statusCounts.all }} 单</span>
      </div>
    </template>

    <div class="callout info">
      <div class="callout-title">已到仓收货 · 清点 → 待上架</div>
      <div class="callout-body">含 ERP 发运入库与已提交的 OMS 客户预约入库。未提交草稿不进入仓库作业列表；已提交但尚未同步至 ERP 的单据仅可查看，同步后可正常收货上架。</div>
    </div>

    <el-alert v-if="warehouseStorageError" :title="warehouseStorageError" type="error" :closable="false"><el-button @click="readPendingOperations">重新读取核对信息</el-button></el-alert>
    <el-alert v-if="listReadError" :title="listReadError" type="error" :closable="false"><el-button @click="load">重新读取列表</el-button></el-alert>
    <el-alert v-if="countsReadError" :title="countsReadError" type="warning" :closable="false"><el-button @click="refreshCounts">刷新状态数量</el-button></el-alert>
    <el-alert v-for="attempt in warehouseAttempts" :key="attempt.payload.clientRequestId" :title="`${attempt.inboundNo} 有原仓库操作待核对`" type="warning" :closable="false">
      作业结果尚未核实，原请求已保存。请核对后继续。
      <el-button :loading="warehouseBusy" @click="retryWarehouseOperation(attempt)">核对并重试原操作</el-button>
      <el-button :disabled="warehouseBusy" @click="continueWarehouseOperation(attempt)">查看并继续作业</el-button>
    </el-alert>
    <el-alert v-if="warehouseNotice" :title="warehouseNotice" type="info" :closable="false" />

    <div class="filter-row">
      <el-radio-group v-model="filter" size="small">
        <el-radio-button v-for="tab in filterTabs" :key="tab.value" :value="tab.value">
          {{ tab.label }}<span v-if="tab.count" class="tab-count">({{ tab.count }})</span>
        </el-radio-button>
      </el-radio-group>
      <span class="spacer" />
      <el-input v-model="searchQ" placeholder="入库单号 / 入仓号 / 跟踪号" clearable style="width:220px" size="small" />
    </div>

    <el-table v-loading="loading" :data="orderRows" stripe border size="small">
      <el-table-column prop="inboundNo" label="入库单" width="130">
        <template #default="{ row }"><span class="mono">{{ row.inboundNo }}</span></template>
      </el-table-column>
      <el-table-column label="来源" width="96" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.dataSource === 'erp' ? 'primary' : row.dataSource === 'erp_oms' ? 'success' : 'warning'">
            {{ row.dataSourceLabel }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="customerCode" label="客户" width="96">
        <template #default="{ row }"><span class="mono">{{ row.customerCode || '—' }}</span></template>
      </el-table-column>
      <el-table-column prop="warehouse" label="目的仓" width="120">
        <template #default="{ row }"><span class="mono">{{ row.warehouse }}</span></template>
      </el-table-column>
      <el-table-column prop="warehouseNo" label="入仓号" width="110">
        <template #default="{ row }">{{ row.warehouseNo || '—' }}</template>
      </el-table-column>
      <el-table-column prop="sku" label="SKU" min-width="120" />
      <el-table-column label="预期数量" width="90" align="right">
        <template #default="{ row }">{{ row.qty.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="customerRemark" label="客户备注" min-width="140" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="创建时间" width="130" />
      <el-table-column label="状态" width="100" fixed="right">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status, row.displayStatus)" size="small">{{ row.statusLabel }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <div class="inbound-row-actions">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          <template v-if="!row.readOnly">
          <el-button
            v-if="!row.readOnly"
            link type="primary" size="small"
            @click="downloadReceivingList(row)"
          >入库清单</el-button>
          <el-button v-if="canPrintSku" link type="primary" size="small" :loading="printingSkuId === row.id" :disabled="printingSkuId != null" @click="printSkuLabels(row)">打印 SKU 标签</el-button>
          <el-button v-if="hasQuantityControl(row)" link type="warning" size="small" :disabled="warehouseBusy || hasPendingOperation(row.id)" @click="openControl(row)">数量更正</el-button>
          <el-button v-if="canPutawayOrder(row)" link type="primary" size="small" @click="openPutaway(row)">上架</el-button>
          <el-button v-if="canManualReceiveOrder(row)" link type="primary" size="small" @click="openManualReceive(row)">手动收货</el-button>
          <el-button v-if="canReopenCount(row)" link type="warning" size="small" :disabled="countManaging" @click="manageCount(row, 'reopen')">更正清点</el-button>
          <el-button v-if="canCloseZero(row)" link type="danger" size="small" :disabled="countManaging" @click="manageCount(row, 'close-zero')">零收货结束</el-button>
          <el-button
            v-if="row.status === 'arrived' && canReceive"
            link type="primary" size="small"
            @click="startReceive(row)"
          >开始收货</el-button>
          <el-button
            v-if="(row.status === 'arrived' || row.status === 'receiving') && canQc"
            link type="primary" size="small"
            @click="openQc(row)"
          >提交清点</el-button>
          <span v-if="row.status === 'pending_receipt' || row.status === 'pushed' || row.status === 'pending_push'" class="muted-op">待到仓扫描</span>
          <el-button
            v-if="row.displayStatus === 'exception' && canResolve"
            link type="warning" size="small"
            @click="resolveException(row)"
          >放行上架</el-button>
          </template>
          <span v-else class="muted-op">OMS 待同步</span>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !orderRows.length" description="暂无入库单" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />

    <WarehouseControlDialog v-model="controlVisible" :inbound-id="controlInboundId" :initial-kind="controlKind" :busy="warehouseBusy" :attempt="controlAttempt" :error-text="warehouseNotice || warehouseStorageError" :submit-action="submitControl" :retry-action="retryControl" />

    <el-dialog v-model="detailVisible" :title="`入库详情 · ${detailOrder?.inboundNo || ''}`" width="760px" class="inbound-detail-dialog erp-detail" destroy-on-close>
      <div v-loading="detailLoading">
        <template v-if="detailOrder">
          <DetailSheet
            :kicker="detailOrder.inboundNo"
            :title="detailOrder.warehouseCode || '入库单'"
            :subtitle="[detailOrder.warehouseNo, detailOrder.trackingNo].filter(Boolean).join(' · ')"
          >
            <template #status>
              <el-tag :type="statusTagType(detailOrder.status, detailOrder.displayStatus)" size="small">
                {{ detailStatusLabel }}
              </el-tag>
            </template>
          </DetailSheet>
          <el-descriptions :column="3" border size="small" class="detail-desc">
            <el-descriptions-item label="入库单号">
              <span class="mono">{{ detailOrder.inboundNo }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTagType(detailOrder.status, detailOrder.displayStatus)" size="small">
                {{ detailStatusLabel }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="目的仓">
              <span class="mono">{{ detailOrder.warehouseCode || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="入仓号">{{ detailOrder.warehouseNo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="始发仓">
              <span class="mono">{{ detailOrder.sourceWarehouseCode || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="跟踪号">{{ detailOrder.trackingNo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ fmtTime(detailOrder.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="到仓时间">{{ detailOrder.arrivedAt ? fmtTime(detailOrder.arrivedAt) : '—' }}</el-descriptions-item>
            <el-descriptions-item label="客户备注" :span="3">
              <span class="remark-text">{{ detailCustomerRemark }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="detail-section-title">明细</div>
          <el-table :data="detailOrder.items || []" border size="small">
            <el-table-column prop="sku" label="SKU" min-width="150">
              <template #default="{ row }">
                <div class="sku-cell">
                  <span class="mono">{{ inboundCustomerSku(row, detailOrder.omsCustomerCode) }}</span>
                  <span v-if="bound990Text(row)" class="bound-990">已绑 {{ bound990Text(row) }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="productName" label="品名" min-width="140" show-overflow-tooltip />
            <el-table-column prop="spec" label="规格" width="88" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '—' }}</template>
            </el-table-column>
            <el-table-column label="预期" width="80" align="right">
              <template #default="{ row }">{{ row.expectedQty ?? 0 }}</template>
            </el-table-column>
            <el-table-column label="实收" width="80" align="right">
              <template #default="{ row }">{{ row.actualQty ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="差异" width="70" align="right">
              <template #default="{ row }">{{ row.diffQty ?? 0 }}</template>
            </el-table-column>
            <el-table-column label="QC" width="80">
              <template #default="{ row }">{{ qcStatusLabel(row.qcStatus) }}</template>
            </el-table-column>
            <el-table-column label="行备注" min-width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || row.qcRemark || '—' }}</template>
            </el-table-column>
          </el-table>

          <template v-if="detailOrder.omsAttachments?.length">
            <div class="detail-section-title">OMS 上传附件</div>
            <div class="att-list">
              <button
                v-for="att in detailOrder.omsAttachments"
                :key="att.id"
                type="button"
                class="att-link"
                @click="downloadOmsAttachment(detailOrder.id, att.id, att.fileName)"
              >
                下载 {{ att.fileName }}
              </button>
            </div>
          </template>
        </template>
      </div>
      <template #footer>
        <el-button v-if="canReopenCount(detailOrder)" :disabled="countManaging" @click="manageCount(detailOrder, 'reopen')">更正清点</el-button>
        <el-button v-if="canCloseZero(detailOrder)" type="danger" :disabled="countManaging" @click="manageCount(detailOrder, 'close-zero')">零收货结束</el-button>
        <el-button v-if="canManualReceiveOrder(detailOrder)" type="primary" @click="openManualReceive(detailOrder)">手动收货</el-button>
        <el-button v-if="canPutawayOrder(detailOrder)" type="primary" @click="openPutaway(detailOrder)">上架</el-button>
        <el-button v-if="detailOrder && !detailOrder.readOnly && !String(detailOrder.id).startsWith('oms-') && canPrintSku" :loading="printingSkuId === detailOrder.id" :disabled="printingSkuId != null" @click="printSkuLabels(detailOrder)">打印 SKU 标签</el-button>
        <el-button
          v-if="detailOrder && !detailOrder.readOnly && !String(detailOrder.id).startsWith('oms-')"
          @click="downloadReceivingList(detailOrder)"
        >下载入库清单</el-button>
        <el-button type="primary" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="manualReceiveVisible" title="手动收货" width="680px" :close-on-click-modal="false" :close-on-press-escape="!manualReceiveSubmitting" :show-close="!manualReceiveSubmitting">
      <div v-loading="manualReceiveLoading">
        <template v-if="manualReceiveOrder">
          <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px" title="请确认货物已到仓。提交将登记到仓及实收箱数；SKU 件数、尺寸和库存由后续清点与上架确认。" />
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="入库单" :span="2">{{ manualReceiveOrder.inboundNo }}</el-descriptions-item>
            <el-descriptions-item label="目的仓">{{ manualReceiveOrder.warehouseCode }}</el-descriptions-item>
            <el-descriptions-item label="应收箱数">{{ manualReceiveOrder.cartons?.length || '未提供' }}</el-descriptions-item>
          </el-descriptions>
          <el-table :data="manualReceiveOrder.items || []" size="small" max-height="240" style="margin:16px 0">
            <el-table-column label="SKU" min-width="140"><template #default="{ row }">{{ inboundCustomerSku(row, manualReceiveOrder.omsCustomerCode) }}</template></el-table-column>
            <el-table-column prop="productName" label="品名" min-width="160" />
            <el-table-column prop="expectedQty" label="预期件数" width="100" />
          </el-table>
          <el-form label-width="100px" @submit.prevent="submitManualReceive">
            <el-form-item label="实收箱数" required>
              <el-input-number v-model="manualReceiveCount" :min="1" :max="9999" :precision="0" placeholder="填写实际箱数" :disabled="manualReceiveSubmitting || !!warehouseStorageError || hasPendingOperation(manualReceiveOrder.id)" />
            </el-form-item>
            <el-form-item label="差异原因">
              <el-input v-model="manualReceiveReason" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="实收与应收箱数不一致时必填" :disabled="manualReceiveSubmitting || !!warehouseStorageError || hasPendingOperation(manualReceiveOrder.id)" />
            </el-form-item>
          </el-form>
        </template>
      </div>
      <template #footer>
        <el-button :disabled="manualReceiveSubmitting" @click="manualReceiveVisible = false">取消</el-button>
        <el-button type="primary" :loading="manualReceiveSubmitting" :disabled="manualReceiveLoading || !canManualReceiveOrder(manualReceiveOrder)" @click="submitManualReceive">确认手动收货</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="qcDialogVisible"
      :title="`提交清点 · ${qcOrder?.inboundNo || ''}`"
      width="960px"
      class="qc-dialog"
      destroy-on-close
      :close-on-click-modal="false"
      :close-on-press-escape="!warehouseBusy"
      :show-close="!warehouseBusy"
    >
      <template v-if="qcOrder">
        <el-descriptions v-loading="qcLoading" :column="3" border size="small" class="qc-summary">
          <el-descriptions-item label="目的仓">
            <span class="mono">{{ qcOrder.warehouseCode || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="入仓号">{{ qcOrder.warehouseNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="跟踪号">{{ qcOrder.trackingNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="应收合计">{{ qcExpectedTotal.toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="始发仓">
            <span class="mono">{{ qcOrder.sourceWarehouseCode || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="实收合计">
            <strong>{{ qcActualTotal.toLocaleString() }}</strong>
          </el-descriptions-item>
          <el-descriptions-item label="SKU 数">{{ qcLines.length }} 种</el-descriptions-item>
          <el-descriptions-item label="客户备注" :span="3">
            <span class="remark-text">{{ qcCustomerRemark }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <div v-loading="qcLoading" class="qc-table-wrap">
          <el-table :data="qcLines" border size="small" stripe style="width:100%">
            <el-table-column prop="sku" label="SKU" min-width="150" fixed="left" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="sku-cell">
                  <span class="mono">{{ row.customerSku || row.sku }}</span>
                  <span v-if="bound990Text(row)" class="bound-990">已绑 {{ bound990Text(row) }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="productName" label="品名" min-width="150" show-overflow-tooltip />
            <el-table-column prop="spec" label="规格" width="88" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '—' }}</template>
            </el-table-column>
            <el-table-column label="行备注" width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ row.lineRemark || '—' }}</template>
            </el-table-column>
            <el-table-column label="应收" width="72" align="right">
              <template #default="{ row }">{{ row.expectedQty.toLocaleString() }}</template>
            </el-table-column>
            <el-table-column label="实收" width="120" align="center">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.actualQty"
                  :min="0"
                  size="small"
                  controls-position="right"
                  class="qc-qty-input"
                  :disabled="warehouseBusy || !!warehouseStorageError || hasPendingOperation(qcOrder.id)"
                />
              </template>
            </el-table-column>
            <el-table-column label="差异" width="72" align="right">
              <template #default="{ row }">
                <span :class="{ 'diff-warn': row.actualQty !== row.expectedQty }">
                  {{ (row.actualQty - row.expectedQty).toLocaleString() }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="QC" width="96" align="center">
              <template #default="{ row }">
                <el-select v-model="row.qcStatus" size="small" class="qc-status-select" :disabled="warehouseBusy || !!warehouseStorageError || hasPendingOperation(qcOrder.id)">
                  <el-option label="通过" value="pass" />
                  <el-option label="异常" value="fail" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="QC 备注" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.qcRemark" size="small" placeholder="破损说明等" clearable :disabled="warehouseBusy || !!warehouseStorageError || hasPendingOperation(qcOrder.id)" />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
      <div v-if="canQc" class="qc-footer">
        <el-checkbox v-model="qcAcceptDiff" :disabled="warehouseBusy || !!warehouseStorageError || hasPendingOperation(qcOrder?.id)">确认接受数量差异</el-checkbox>
      </div>
      <template #footer>
        <el-button :disabled="warehouseBusy" @click="qcDialogVisible = false">返回列表</el-button>
        <el-button v-if="!hasPendingOperation(qcOrder?.id)" type="primary" :loading="warehouseBusy" :disabled="qcLoading || !!warehouseStorageError" @click="submitQc">提交清点</el-button>
        <el-button v-else type="primary" :loading="warehouseBusy" @click="retryWarehouseOperation(warehouseAttempts.find(row => row.inboundId === Number(qcOrder?.id))!)">核对并重试原操作</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.inbound-row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.inbound-row-actions :deep(.el-button + .el-button) { margin-left: 0; }
.page-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.page-title { font-weight:600; font-size:15px; }
.page-meta { font-size:13px; color:var(--el-text-color-secondary); }
.callout { padding:12px 16px; border-radius:8px; margin-bottom:12px; font-size:13px; }
.callout.info { background:#eef6ff; border:1px solid #c5dff8; color:#3d4f63; }
.callout-title { font-weight:600; margin-bottom:4px; }
.filter-row { display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
.tab-count { margin-left:2px; font-size:11px; opacity:0.85; }
.spacer { flex:1; }
.mono { font-family:var(--font-mono,Consolas,monospace); font-size:12px; }
.sku-cell { display:flex; flex-direction:column; gap:2px; min-width:0; }
.bound-990 { font-size:11px; color:var(--el-color-warning); font-family:var(--font-mono,Consolas,monospace); }
.qc-footer { margin-top:12px; font-size:13px; }
.qc-summary { margin-bottom: 12px; }
.qc-table-wrap { width: 100%; overflow-x: auto; margin-bottom: 8px; }
.qc-table-wrap :deep(.el-table) { min-width: 880px; }
.qc-qty-input { width: 100%; max-width: 108px; }
.qc-qty-input :deep(.el-input__wrapper) { padding-left: 8px; padding-right: 28px; }
.qc-status-select { width: 100%; }
.diff-warn { color: var(--el-color-warning); font-weight: 600; }
:deep(.qc-dialog) { max-width: 96vw; }
:deep(.qc-dialog .el-dialog__body) { padding-top: 12px; }
.muted-op { color:var(--el-text-color-placeholder); font-size:12px; }
.detail-desc { margin-bottom:16px; }
.detail-section-title { font-weight:600; font-size:13px; margin:4px 0 8px; }
.att-list { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
.att-link { font-size:12px; color:var(--el-color-primary); background:none; border:none; cursor:pointer; padding:0; text-decoration:underline; }
.remark-text { white-space:pre-wrap; word-break:break-word; }
:global(.inbound-detail-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 16px) !important;
  margin: 8px auto !important;
  overflow: hidden;
}
:global(.inbound-detail-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto !important;
}
:global(.inbound-detail-dialog .el-descriptions__cell) { padding: 6px 8px !important; }
:global(.inbound-detail-dialog .el-table .el-table__cell) { padding: 5px 0 !important; }
:global(.inbound-detail-dialog .detail-desc) { margin-bottom: 10px; }
</style>
