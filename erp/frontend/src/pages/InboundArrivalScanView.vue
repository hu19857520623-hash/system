<script setup lang="ts">
import { userFacingError } from '@erp/shared/user-facing-error'

import { displaySku, displaySkuText } from '@erp/shared/sku-display'
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { inboundApi, warehouseApi, locationApi } from '@/api/client.js'
import { mapWarehouse } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'
import { INBOUND_STATUS } from '@/constants/index.js'
import WarehouseControlDialog from '@/components/inbound/WarehouseControlDialog.vue'
import { warehouseControlOptions, type WarehouseControlKind } from '@/utils/warehouseControl'
import { clearWarehouseAttempt, readWarehouseAttempts, runWarehouseAttempt, saveWarehouseAttempt, recoverWarehouseAttemptFailure, type WarehouseAttempt, type WarehouseOperation } from '@/utils/warehouseOperation'

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

function lineMatchesScan(line: any, raw: string): boolean {
  const token = String(raw || '').trim().toUpperCase()
  if (!token) return false
  if (String(line?.sku || '').trim().toUpperCase() === token) return true
  const aliases = [
    line?.barcode,
    line?.platformBarcode,
    ...(Array.isArray(line?.platformBarcodes) ? line.platformBarcodes : []),
  ]
  return aliases.some((a) => String(a || '').trim().toUpperCase() === token)
}

const app = useAppStore()
const route = useRoute()
const router = useRouter()

function returnToReceipt() {
  void router.push({ name: 'InboundReceipt', query: activeOrderId.value ? { inboundId: String(activeOrderId.value) } : {} })
}

type WorkStep = 'arrival' | 'receive' | 'qc' | 'putaway'

const warehouseCode = ref('')
const overseasWarehouses = ref<ReturnType<typeof mapWarehouse>[]>([])

/** 到仓扫描 */
const scanCode = ref('')
const scanning = ref(false)
const scanInputRef = ref<{ focus: () => void } | null>(null)
const lastResult = ref<{ ok: boolean; message: string; order?: any } | null>(null)
const recentScans = ref<any[]>([])
const loadingRecent = ref(false)

/** 当前作业入库单 */
const activeOrderId = ref<number | null>(null)
const activeOrder = ref<any>(null)
const loadingOrder = ref(false)
const warehouseBusy = ref(false)
const warehouseAttempts = ref<WarehouseAttempt[]>([])
const warehouseAttemptError = ref('')
const warehouseOperationError = ref('')
const warehouseResult = ref<any>(null)
const orderReadError = ref('')
const referenceReadError = ref('')
const recentReadError = ref('')
const orderListReadError = ref('')
const locationReadError = ref('')
let recentReadVersion = 0, orderListReadVersion = 0, locationReadVersion = 0
let orderReadVersion = 0
const workStep = ref<WorkStep>('arrival')
const activeOrders = ref<any[]>([])
// 当前单据完成后会移出待作业列表，仍需保留其最新标签供用户核对结果。
const activeOrderChoices = computed(() => {
  const current = activeOrder.value
  if (!current || current.warehouseCode !== warehouseCode.value) return activeOrders.value
  return [current, ...activeOrders.value.filter(order => Number(order.id) !== Number(current.id))]
})

function changeActiveOrder(id: number | null) {
  if (pageBusy.value) return
  warehouseResult.value = null
  warehouseOperationError.value = ''
  orderReadError.value = ''
  if (id) {
    void loadActiveOrder(id)
    return
  }
  activeOrder.value = null
  ++orderReadVersion
  qcLines.value = []
  putawayDraftLines.value = []
  qcSelectedItemId.value = null
  putawaySelectedItemId.value = null
  workStep.value = 'arrival'
}

/** 扫箱收货 */
const manualCartonCount = ref<number | null>(null)
const manualCartonDifferenceReason = ref('')
const manualCartonSaving = ref(false)
const boxScanCode = ref('')
const boxScanning = ref(false)
const boxScanRef = ref<{ focus: () => void } | null>(null)

/** 人工清点 */
const qcLines = ref<any[]>([])
const qcAcceptDiff = ref(false)

/** 清点与测量、扫码上架 */
const qcSubmitting = ref(false)
const qcSkuScan = ref('')
const qcScanIncrement = ref(1)
const qcSelectedItemId = ref<number | null>(null)
const qcScanning = ref(false)
const qcScanRef = ref<{ focus: () => void } | null>(null)
const putawaySkuScan = ref('')
const putawayLocationScan = ref('')
const putawayQty = ref(1)
const putawaySelectedItemId = ref<number | null>(null)
const putawayDraftLines = ref<any[]>([])
const locationOptions = ref<any[]>([])
const putawayScanRef = ref<{ focus: () => void } | null>(null)
const locationScanRef = ref<{ focus: () => void } | null>(null)
const pendingWarehouseAttempt = computed(() => warehouseAttempts.value.find(row => row.inboundId === Number(activeOrderId.value)) || null)
const pageBusy = computed(() => warehouseBusy.value || scanning.value || manualCartonSaving.value || boxScanning.value || qcScanning.value || qcSubmitting.value)
const receivingLocked = computed(() => pageBusy.value || loadingOrder.value || !!pendingWarehouseAttempt.value || !!warehouseAttemptError.value || !!orderReadError.value)
const cartonReady = computed(() => activeOrder.value?.cartonConfirmation?.ready === true)

const canScan = computed(() => app.hasPerm('inbound.arrival_scan'))
const canReceive = computed(() => app.hasPerm('inbound.receive'))
const canQc = computed(() => app.hasPerm('inbound.qc'))
const canPutaway = computed(() => app.hasPerm('inbound.putaway'))
const canResolve = computed(() =>
  canQc.value
  || canPutaway.value
  || app.hasPerm('inbound.handle_exception')
  || app.hasPerm('inbound.confirm_diff'),
)

const activeStatusLabel = computed(() => {
  const o = activeOrder.value
  if (!o) return '—'
  const key = o.displayStatus || o.status
  return INBOUND_STATUS[key]?.label || '待核对'
})

const receiveProgress = computed(() => {
  const items = activeOrder.value?.items || []
  const expected = items.reduce((s: number, i: any) => s + (i.expectedQty || 0), 0)
  const received = items.reduce((s: number, i: any) => s + (i.actualQty ?? 0), 0)
  return { expected, received, remaining: Math.max(0, expected - received) }
})

const receiveCartonProgress = computed(() => {
  const order = activeOrder.value
  const expected = order?.cartons?.length ?? 0
  const scanned = receivedCartons.value.length
  const confirmed = order?.receivedCartonCount ?? null
  return { expected, scanned, confirmed }
})

function skuPackingLabel(order: any, sku: string) {
  const entries = (order?.cartons || []).flatMap((c: any) =>
    (c.items || []).filter((i: any) => String(i.sku) === sku).map((i: any) => Number(i.qty) || 0),
  )
  if (!entries.length) return '—'
  const boxCount = entries.length
  const qtySet = [...new Set(entries)]
  if (qtySet.length === 1) return `${boxCount}箱 × ${qtySet[0]}件/箱`
  return `${boxCount}箱（混装 ${entries.join('+')} 件/箱）`
}

function syncManualCartonCount(order?: any) {
  if (!order) {
    manualCartonCount.value = null
    return
  }
  if (order.receivedCartonCount != null && order.receivedCartonCount > 0) {
    manualCartonCount.value = order.receivedCartonCount
    return
  }
  const scanned = (order.cartons || []).filter((c: any) => c.status === 'received').length
  if ((order.cartons?.length ?? 0) > 0) {
    manualCartonCount.value = scanned || order.cartons.length || 1
    return
  }
  manualCartonCount.value = 1
}

const hasOuterCartons = computed(() => (activeOrder.value?.cartons?.length ?? 0) > 0)
const receivedCartons = computed(() =>
  (activeOrder.value?.cartons || []).filter((c: any) => c.status === 'received'),
)

const putawayLines = computed(() => putawayDraftLines.value)

const putawaySelectedLine = computed(() =>
  putawayDraftLines.value.find((i: any) => i.id === putawaySelectedItemId.value) || null,
)

const putawaySummary = computed(() => ({
  sku: putawayReadyLines.value.length,
  qty: putawayReadyLines.value.reduce((s, i) => s + Number(i.remaining || 0), 0),
}))

const measureSummary = computed(() => {
  const pending = putawayDraftLines.value
  const measured = pending.filter((l) => hasDimensions(l) && l.dimensionsSource === 'measured')
  return {
    total: pending.length,
    measured: measured.length,
    pending: pending.length - measured.length,
  }
})

const putawayReadyLines = computed(() => putawayDraftLines.value.filter((l) => hasDimensions(l) && l.dimensionsSource === 'measured'))

function hasDimensions(line: { lengthCm?: number; widthCm?: number; heightCm?: number }) {
  return [line.lengthCm, line.widthCm, line.heightCm].every((v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 999999.99)
}

function orderNeedsMeasure(order: any) {
  return (order?.items || []).some((item: any) => {
    const actual = item.actualQty ?? item.expectedQty
    const remaining = actual - (item.putawayQty ?? 0)
    return remaining > 0 && (!hasDimensions(item) || item.dimensionsSource !== 'measured')
  })
}

const qcMeasureSummary = computed(() => {
  const lines = qcLines.value
  const measured = lines.filter((l) => hasDimensions(l)).length
  return {
    total: lines.length,
    measured,
    pending: lines.length - measured,
  }
})

const stepActiveIndex = computed(() => {
  const map: Record<WorkStep, number> = { arrival: 0, receive: 1, qc: 2, putaway: 3 }
  return map[workStep.value] ?? 0
})

function canShowQcStep(order: any) {
  if (!order) return false
  if (['arrived', 'receiving', 'exception'].includes(order.status)) return true
  return order.status === 'pending_putaway'
}

const canEditQcQty = computed(() =>
  canQc.value && !!activeOrder.value && ['arrived', 'receiving'].includes(activeOrder.value.status),
)

const qcSelectedLine = computed(() =>
  qcLines.value.find((l) => l.id === qcSelectedItemId.value) || null,
)

function buildPutawayDraft(order: any) {
  putawayDraftLines.value = (order?.items || [])
    .map((item: any) => {
      const actual = item.actualQty ?? item.expectedQty
      const remaining = actual - (item.putawayQty ?? 0)
      return {
        id: item.id,
        sku: item.sku,
        barcode: item.barcode || '',
        platformBarcode: item.platformBarcode || '',
        platformBarcodes: item.platformBarcodes || [],
        productName: item.productName || '',
        actualQty: actual,
        putawayQty: item.putawayQty ?? 0,
        remaining,
        locationCode: '',
        lengthCm: item.lengthCm ?? undefined,
        widthCm: item.widthCm ?? undefined,
        heightCm: item.heightCm ?? undefined,
        dimensionsSource: item.dimensionsSource || null,
      }
    })
    .filter((i: any) => i.remaining > 0)

  if (putawayDraftLines.value.length) {
    putawaySelectedItemId.value = putawayReadyLines.value[0]?.id ?? putawayDraftLines.value[0].id
    putawayQty.value = (putawayReadyLines.value[0] ?? putawayDraftLines.value[0]).remaining
  } else {
    putawaySelectedItemId.value = null
    putawayQty.value = 1
  }
}

function buildPutawayDraftFromActive() {
  if (activeOrder.value) buildPutawayDraft(activeOrder.value)
}

function statusTagType(status: string) {
  if (status === 'exception') return 'danger'
  if (status === 'arrived' || status === 'receiving') return 'warning'
  if (status === 'pending_putaway') return 'warning'
  if (status === 'completed' || status === 'confirmed') return 'success'
  return 'info'
}

function deriveWorkStep(order: any): WorkStep {
  const st = order.status
  if (st === 'pending_putaway' || st === 'exception') {
    return orderNeedsMeasure(order) ? 'qc' : 'putaway'
  }
  if (st === 'receiving' || st === 'arrived') return 'receive'
  if (['completed', 'confirmed'].includes(st)) return 'putaway'
  return 'arrival'
}

function buildQcLines(order: any) {
  qcLines.value = (order.items || []).map((item: any) => ({
    id: item.id,
    sku: item.sku,
    barcode: item.barcode || '',
    platformBarcode: item.platformBarcode || '',
    platformBarcodes: item.platformBarcodes || [],
    productName: item.productName || item.sku,
    spec: item.spec || '',
    expectedQty: item.expectedQty,
    actualQty: item.actualQty ?? 0,
    qcStatus: item.qcStatus === 'fail' ? 'fail' : 'pass',
    qcRemark: item.qcRemark || '',
    lengthCm: item.lengthCm ?? undefined,
    widthCm: item.widthCm ?? undefined,
    heightCm: item.heightCm ?? undefined,
  }))
  if (!qcSelectedItemId.value && qcLines.value.length) {
    qcSelectedItemId.value = qcLines.value.find((l) => !hasDimensions(l))?.id ?? qcLines.value[0].id
  }
}

async function loadWarehouses() {
  referenceReadError.value = ''
  try {
    const res = await warehouseApi.list({ type: 'overseas' })
    overseasWarehouses.value = (Array.isArray(res) ? res : res.items || []).map(mapWarehouse)
    if (!warehouseCode.value && overseasWarehouses.value.length) {
      warehouseCode.value = overseasWarehouses.value[0].warehouseCode
    }
  } catch (error) {
    referenceReadError.value = `仓库选项未能读取，请重试。${userFacingError(error)}`
  }
}

async function loadRecent() {
  const version = ++recentReadVersion, code = warehouseCode.value
  recentReadError.value = ''
  if (!warehouseCode.value) {
    recentScans.value = []
    return
  }
  loadingRecent.value = true
  try {
    const rows = await inboundApi.listArrivalScans({ warehouseCode: warehouseCode.value, limit: 30 })
    if (version !== recentReadVersion || code !== warehouseCode.value) return
    recentScans.value = Array.isArray(rows) ? rows : []
  } catch (error) {
    if (version === recentReadVersion) recentReadError.value = `最近扫描记录未能刷新，不能据此判断是否已到仓。${userFacingError(error)}`
  } finally {
    if (version === recentReadVersion) loadingRecent.value = false
  }
}

async function loadActiveOrderList() {
  const version = ++orderListReadVersion, code = warehouseCode.value
  orderListReadError.value = ''
  if (!warehouseCode.value) {
    activeOrders.value = []
    return
  }
  try {
    const res = await inboundApi.list({ pageSize: 100 })
    if (version !== orderListReadVersion || code !== warehouseCode.value) return
    const rows = res.items || []
    activeOrders.value = rows.filter((o: any) =>
      o.warehouseCode === warehouseCode.value
      && ['arrived', 'receiving', 'pending_putaway', 'exception'].includes(o.status),
    )
  } catch (error) {
    if (version === orderListReadVersion) orderListReadError.value = `作业入库单未能刷新，请重新读取后选择。${userFacingError(error)}`
  }
}

async function loadActiveOrder(id: number, preferredStep?: WorkStep) {
  const version = ++orderReadVersion
  activeOrderId.value = id
  loadingOrder.value = true
  orderReadError.value = ''
  try {
    const data = await inboundApi.detail(id)
    if (version !== orderReadVersion || Number(activeOrderId.value) !== id) return false
    activeOrderId.value = id
    activeOrder.value = data
    if (warehouseCode.value !== data.warehouseCode) warehouseCode.value = data.warehouseCode
    buildQcLines(data)
    workStep.value = preferredStep || deriveWorkStep(data)
    if (workStep.value === 'putaway' && data.status === 'pending_putaway' && orderNeedsMeasure(data)) workStep.value = 'qc'
    if (workStep.value === 'qc' && ['arrived', 'receiving'].includes(data.status) && !data.cartonConfirmation?.ready) workStep.value = 'receive'
    buildPutawayDraft(data)
    syncManualCartonCount(data)
    if (workStep.value === 'putaway') {
      await loadLocations(data.warehouseCode)
    }
    return true
  } catch (e: any) {
    if (version === orderReadVersion) orderReadError.value = `最新单据未能读取，请重新读取后继续作业。${userFacingError(e)}`
    return false
  } finally {
    if (version === orderReadVersion) loadingOrder.value = false
  }
}

async function loadLocations(wh?: string) {
  const code = wh || activeOrder.value?.warehouseCode
  if (!code) return
  const version = ++locationReadVersion
  locationReadError.value = ''; locationOptions.value = []
  try {
    const rows = await locationApi.list({ warehouseCode: code, status: 'available' })
    if (version !== locationReadVersion) return
    locationOptions.value = Array.isArray(rows) ? rows : rows.items || []
  } catch (error) {
    if (version === locationReadVersion) locationReadError.value = `可用库位未能读取，请重试后再上架。${userFacingError(error)}`
  }
}

function focusScan() {
  nextTick(() => scanInputRef.value?.focus())
}

function focusBoxScan() {
  nextTick(() => boxScanRef.value?.focus())
}

function focusPutawayScan() {
  nextTick(() => putawayScanRef.value?.focus())
}

function focusQcScan() {
  nextTick(() => qcScanRef.value?.focus())
}

function refreshWarehouseAttempts() {
  try { warehouseAttempts.value = readWarehouseAttempts(localStorage, app.authenticatedUser!.id); warehouseAttemptError.value = '' }
  catch (error) { warehouseAttemptError.value = userFacingError(error) }
}

async function restoreWarehouseAttempt(attempt: WarehouseAttempt) {
  if (pageBusy.value) return
  warehouseCode.value = attempt.warehouseCode
  await nextTick()
  ++orderReadVersion
  activeOrderId.value = attempt.inboundId
  activeOrder.value = JSON.parse(JSON.stringify(attempt.snapshot.order))
  if (attempt.snapshot.qcLines) qcLines.value = JSON.parse(JSON.stringify(attempt.snapshot.qcLines))
  else buildQcLines(activeOrder.value)
  manualCartonCount.value = attempt.payload.receivedCartonCount ?? activeOrder.value.receivedCartonCount
  manualCartonDifferenceReason.value = attempt.payload.differenceReason || ''
  qcSkuScan.value = attempt.kind === 'qc-scan' ? attempt.payload.scanCode : ''
  qcScanIncrement.value = attempt.payload.increment ?? 1
  boxScanCode.value = attempt.kind === 'carton-scan' ? attempt.payload.scanCode : ''
  workStep.value = ['putaway', 'reduce-putaway'].includes(attempt.kind) ? 'putaway' : attempt.kind.startsWith('carton-') || attempt.kind === 'reduce-carton' ? 'receive' : 'qc'
  if (['putaway', 'reduce-putaway'].includes(attempt.kind)) {
    buildPutawayDraft(activeOrder.value)
    for (const group of attempt.payload.items || []) {
      const line = putawayDraftLines.value.find(row => Number(row.id) === Number(group.inboundItemId))
      if (line) line.locationCode = group.lines?.[0]?.locationCode || ''
    }
    putawaySelectedItemId.value = attempt.kind === 'putaway' ? attempt.payload.items?.[0]?.inboundItemId ?? null : attempt.payload.inboundItemId ?? null
    putawayQty.value = attempt.kind === 'putaway' ? attempt.payload.items?.[0]?.lines?.[0]?.qty ?? 1 : 1
  }
  orderReadError.value = ''; warehouseOperationError.value = ''; warehouseResult.value = null
  if (['resolve-exception', 'reopen-count', 'close-zero', 'reduce-qc', 'reduce-carton', 'reduce-putaway'].includes(attempt.kind)) {
    controlKind.value = attempt.kind as WarehouseControlKind; controlVisible.value = true
  }
}

async function beginWarehouseOperation(kind: WarehouseOperation, payload: any) {
  refreshWarehouseAttempts()
  if (receivingLocked.value || !activeOrder.value) return false
  const order = activeOrder.value
  const attempt: WarehouseAttempt = { kind, inboundId: Number(order.id), inboundNo: order.inboundNo, warehouseCode: order.warehouseCode,
    payload: { ...payload, clientRequestId: crypto.randomUUID() }, snapshot: { order, qcLines: qcLines.value } }
  try { saveWarehouseAttempt(localStorage, app.authenticatedUser!.id, attempt); refreshWarehouseAttempts() }
  catch (error) { warehouseOperationError.value = userFacingError(error); return false }
  await postWarehouseOperation(warehouseAttempts.value.find(row => row.inboundId === attempt.inboundId)!)
  return !warehouseOperationError.value && !warehouseAttempts.value.some(row => row.inboundId === attempt.inboundId)
}

async function postWarehouseOperation(attempt: WarehouseAttempt) {
  if (pageBusy.value) return
  warehouseBusy.value = true
  const operatorId = Number(app.authenticatedUser?.id)
  warehouseOperationError.value = ''; warehouseResult.value = null
  let result: any
  try {
    result = await runWarehouseAttempt(inboundApi, attempt)
    if (result.feePending || result.syncPending) {
      warehouseOperationError.value = result.warning || '作业已保存，费用同步待核对，请用原操作重试'
      warehouseResult.value = { ...result, inboundNo: attempt.inboundNo }; return
    }
    try { clearWarehouseAttempt(localStorage, operatorId, attempt); refreshWarehouseAttempts() }
    catch { warehouseOperationError.value = '原操作已完成，但本机核对信息未能清除；请核对原操作，勿重新建立操作' }
    warehouseResult.value = { ...result, inboundNo: attempt.inboundNo }
    const preferred: WorkStep = ['putaway', 'reduce-putaway'].includes(attempt.kind) ? 'putaway' : attempt.kind.startsWith('carton-') || attempt.kind === 'reduce-carton' ? 'receive' : 'qc'
    const fresh = await loadActiveOrder(attempt.inboundId, preferred)
    if (!fresh) warehouseOperationError.value = '本次作业已保存，最新进度未能读取；请先重新读取单据，不要重复提交'
    await Promise.allSettled([loadRecent(), loadActiveOrderList()])
    ElMessage.success(displaySkuText(result.message || '仓库作业已保存'))
    if (fresh) {
      if (attempt.kind === 'qc-scan') { qcSelectedItemId.value = result.itemId; qcSkuScan.value = ''; focusQcScan() }
      if (attempt.kind === 'carton-scan') { boxScanCode.value = ''; focusBoxScan() }
      if (attempt.kind === 'carton-count') manualCartonDifferenceReason.value = ''
      if (attempt.kind === 'putaway') {
        putawaySkuScan.value = ''; putawayLocationScan.value = ''
        if (putawayReadyLines.value.length) {
          putawaySelectedItemId.value = putawayReadyLines.value[0].id; putawayQty.value = putawayReadyLines.value[0].remaining
          focusPutawayScan()
        }
      }
    }
  } catch (error: any) {
    const recovery = recoverWarehouseAttemptFailure(localStorage, operatorId, attempt, error)
    warehouseOperationError.value = recovery.message
    refreshWarehouseAttempts()
    if (!recovery.retained) {
      if (error.status === 404 || error.status === 409) orderReadError.value = '原单或作业进度已变更，请重新读取最新单据后继续'
    }
  } finally { warehouseBusy.value = false }
  if (result && !result.feePending && !result.syncPending && !orderReadError.value && !pendingWarehouseAttempt.value) {
    if (attempt.kind === 'carton-count' && canQc.value) goToQcStep()
    if (attempt.kind === 'close-zero') workStep.value = 'putaway'
    if (attempt.kind === 'resolve-exception' && activeOrder.value?.status === 'pending_putaway' && !orderNeedsMeasure(activeOrder.value) && receiveProgress.value.received > 0) await goPutawayStep()
    if ((attempt.kind === 'qc-measure-submit' || attempt.kind === 'measure') && activeOrder.value?.status === 'pending_putaway' && !orderNeedsMeasure(activeOrder.value)) {
      if (receiveProgress.value.received > 0) await goPutawayStep()
      else ElMessage.info('全部实收为0，请返回入库单管理核对并选择零收货结束')
    }
  }
}

async function submitQcScan() {
  if (!activeOrder.value || receivingLocked.value) return
  const code = qcSkuScan.value.trim()
  if (!code) { ElMessage.warning('请扫描 SKU'); return }
  if (!canQc.value) {
    const line = qcLines.value.find(line => lineMatchesScan(line, code))
    if (!line) { ElMessage.warning('扫描码未匹配当前明细，请选择 SKU'); return }
    qcSelectedItemId.value = line.id; qcSkuScan.value = ''; ElMessage.info('已定位 SKU，请填写测量数据后保存'); return
  }
  if (!Number.isSafeInteger(qcScanIncrement.value) || qcScanIncrement.value <= 0) { ElMessage.warning('每次件数须为正整数'); return }
  await beginWarehouseOperation('qc-scan', { scanCode: code, increment: canEditQcQty.value ? qcScanIncrement.value : 0 })
}

async function submitArrivalScan() {
  if (!canScan.value || pageBusy.value) return
  const code = scanCode.value.trim()
  if (!warehouseCode.value) {
    ElMessage.warning('请选择海外仓')
    return
  }
  if (!code) {
    ElMessage.warning('请扫描或输入单号')
    return
  }
  scanning.value = true
  try {
    const res = await inboundApi.arrivalScan({ scanCode: code, warehouseCode: warehouseCode.value })
    lastResult.value = {
      ok: true,
      message: res.message || '到仓扫描成功',
      order: res.order,
    }
    if (res.alreadyScanned) {
      ElMessage.info(displaySkuText(res.message || '该单已到仓'))
    } else {
      ElMessage.success(displaySkuText(res.message || '到仓扫描成功'))
    }
    scanCode.value = ''
    await loadRecent()
    await loadActiveOrderList()
    if (res.order?.id) {
      await loadActiveOrder(res.order.id, 'receive')
      workStep.value = 'receive'
      focusBoxScan()
    } else {
      focusScan()
    }
  } catch (e: any) {
    lastResult.value = { ok: false, message: userFacingError(e) }
    ElMessage.error(userFacingError(displaySkuText(e?.message || '扫描失败')))
    focusScan()
  } finally {
    scanning.value = false
  }
}

async function submitReceiveCartonScan() {
  if (!canReceive.value || !activeOrder.value || receivingLocked.value) return
  const code = boxScanCode.value.trim()
  if (!code) { ElMessage.warning('请扫描外箱标'); return }
  await beginWarehouseOperation('carton-scan', { scanCode: code })
}

async function submitManualCartonCount() {
  if (!canReceive.value || !activeOrder.value || receivingLocked.value) return
  const count = Number(manualCartonCount.value)
  if (!Number.isSafeInteger(count) || count <= 0 || count > 9999) { ElMessage.warning('实收箱数须为1至9999的整数'); return }
  const expected = activeOrder.value.cartons?.length || 0, reason = manualCartonDifferenceReason.value.trim()
  if (expected && expected !== count && reason.length < 2) { ElMessage.warning('实收箱数与应收不符，请填写差异原因'); return }
  await beginWarehouseOperation('carton-count', { receivedCartonCount: count, differenceReason: reason || undefined })
}

function goToQcStep() {
  if (!activeOrder.value || pageBusy.value) return
  if (!canShowQcStep(activeOrder.value)) {
    ElMessage.warning('当前状态不可清点与测量')
    return
  }
  if (['arrived', 'receiving'].includes(activeOrder.value.status) && !cartonReady.value) {
    ElMessage.warning(activeOrder.value.cartonConfirmation?.message || '请先确认实收箱数')
    return
  }
  buildQcLines(activeOrder.value)
  workStep.value = 'qc'
  qcSelectedItemId.value = qcLines.value.find((l) => !hasDimensions(l))?.id ?? qcLines.value[0]?.id ?? null
  focusQcScan()
}

function measurePayloadFromQcLine(line: any) {
  return {
    inboundItemId: line.id,
    lengthCm: line.lengthCm,
    widthCm: line.widthCm,
    heightCm: line.heightCm,
  }
}

async function submitQcAndMeasure() {
  if (!activeOrder.value || receivingLocked.value) return
  const order = activeOrder.value
  if (order.status === 'exception') { ElMessage.warning('清点存在异常，请先核对并由有权限的岗位处理'); return }
  const needsQc = ['arrived', 'receiving'].includes(order.status)
  if (needsQc && !canQc.value) { ElMessage.warning('当前岗位无清点提交权限'); return }
  if (!needsQc && (order.status !== 'pending_putaway' || !canPutaway.value)) { ElMessage.warning('当前状态或岗位不能保存测量，请返回入库单管理查看进度'); return }
  if (qcLines.value.some(line => !Number.isSafeInteger(Number(line.actualQty)) || Number(line.actualQty) < 0)) { ElMessage.warning('各SKU实收件数须为不小于零的整数'); return }
  const positive = qcLines.value.filter(line => Number(line.actualQty) > 0)
  if (canPutaway.value && positive.some(line => !hasDimensions(line))) { ElMessage.warning('实收大于零的SKU请填写完整有效的长宽高'); return }
  if (needsQc) {
    const measured = canPutaway.value
    await beginWarehouseOperation(measured ? 'qc-measure-submit' : 'qc-submit', {
      expectedVersion: measured ? order.measurementVersion : order.receivingVersion,
      acceptDiff: qcAcceptDiff.value,
      items: qcLines.value.map(line => ({ id: Number(line.id), sku: line.sku, actualQty: Number(line.actualQty), qcStatus: line.qcStatus, qcRemark: line.qcRemark || undefined,
        ...(measured && Number(line.actualQty) > 0 ? { lengthCm: Number(line.lengthCm), widthCm: Number(line.widthCm), heightCm: Number(line.heightCm) } : {}) })),
    })
  } else {
    if (!positive.length) { ElMessage.info('全部实收为0，请返回入库单管理核对并选择零收货结束'); return }
    await beginWarehouseOperation('measure', { expectedVersion: order.measurementVersion, items: positive.map(measurePayloadFromQcLine) })
  }
}

function resolveLocationCode(raw: string) {
  const code = raw.trim().toUpperCase()
  if (!code) return ''
  const hit = locationOptions.value.find(
    (l: any) => String(l.locationCode || l.code || '').toUpperCase() === code,
  )
  return hit ? (hit.locationCode || hit.code) : raw.trim().toUpperCase()
}

function onPutawaySkuScan() {
  const code = putawaySkuScan.value.trim()
  if (!code) return
  const line = putawayReadyLines.value.find((i: any) => lineMatchesScan(i, code))
  if (!line) {
    ElMessage.warning(displaySkuText(`SKU ${putawaySkuScan.value} 不在待上架明细中`))
    return
  }
  putawaySelectedItemId.value = line.id
  putawayQty.value = line.remaining
  putawaySkuScan.value = ''
  nextTick(() => locationScanRef.value?.focus())
}

function applyLocationScanToSelected() {
  const locRaw = putawayLocationScan.value.trim()
  if (!locRaw || !putawaySelectedLine.value) return false
  putawaySelectedLine.value.locationCode = resolveLocationCode(locRaw)
  return true
}

function onPutawayLocationScan() {
  if (applyLocationScanToSelected()) {
    putawayLocationScan.value = ''
    ElMessage.success(`已填入库位 ${putawaySelectedLine.value?.locationCode}`)
  }
}

function validatePutawayLine(item: any, qty?: number) {
  if (locationReadError.value) { ElMessage.warning('请先重新读取可用库位'); return false }
  if (receivingLocked.value) { ElMessage.warning('请先核对原操作并重新读取最新单据'); return false }
  const targetQty = qty ?? item.remaining
  if (!hasDimensions(item) || item.dimensionsSource !== 'measured') {
    ElMessage.warning(displaySkuText(`${displaySku(item)} 请先完成体积测量`))
    return false
  }
  if (!item.locationCode) {
    ElMessage.warning(displaySkuText(`请为 SKU ${displaySku(item)} 选择库位`))
    return false
  }
  if (!Number.isSafeInteger(targetQty) || targetQty <= 0 || targetQty > item.remaining) {
    ElMessage.warning(displaySkuText(`${displaySku(item)} 上架数量无效（待上架 ${item.remaining}）`))
    return false
  }
  return true
}

function putawayPayloadItem(item: any, qty: number) {
  return {
    inboundItemId: item.id,
    lines: [{ locationCode: resolveLocationCode(item.locationCode), qty }],
  }
}

async function submitPutawayScan() {
  if (receivingLocked.value) return
  if (!canPutaway.value || !activeOrder.value || !putawaySelectedLine.value) {
    ElMessage.warning('请选择待上架 SKU')
    return
  }
  if (activeOrder.value.status === 'exception') {
    ElMessage.warning('入库单处于异常状态，请先点击「确认并继续」后再上架')
    return
  }
  if (activeOrder.value.status !== 'pending_putaway') {
    ElMessage.warning('当前入库单状态不可上架，请先完成清点')
    return
  }

  applyLocationScanToSelected()
  const line = putawaySelectedLine.value
  const qty = Number(putawayQty.value)
  if (!validatePutawayLine(line, qty)) return

  await beginWarehouseOperation('putaway', {
    expectedVersion: activeOrder.value.measurementVersion,
    items: [putawayPayloadItem(line, qty)],
  })
}

async function submitPutawayAll() {
  if (receivingLocked.value) return
  if (!canPutaway.value || !activeOrder.value) return
  if (activeOrder.value.status === 'exception') {
    ElMessage.warning('入库单处于异常状态，请先点击「确认并继续」后再上架')
    return
  }
  if (activeOrder.value.status !== 'pending_putaway') {
    ElMessage.warning('当前入库单状态不可上架，请先完成清点')
    return
  }
  if (!putawayReadyLines.value.length) {
    ElMessage.warning('暂无已测量、待上架的明细')
    return
  }

  for (const item of putawayReadyLines.value) {
    if (!validatePutawayLine(item, item.remaining)) return
  }

  await beginWarehouseOperation('putaway', {
    expectedVersion: activeOrder.value.measurementVersion,
    items: putawayReadyLines.value.map(item => putawayPayloadItem(item, item.remaining)),
  })
}

async function goPutawayStep() {
  if (receivingLocked.value || !activeOrder.value) return
  if (['completed', 'confirmed'].includes(activeOrder.value.status)) { workStep.value = 'putaway'; return }
  buildPutawayDraftFromActive()
  buildQcLines(activeOrder.value)
  if (measureSummary.value.pending > 0) {
    ElMessage.warning(`还有 ${measureSummary.value.pending} 个 SKU 未完成清点与测量`)
    workStep.value = 'qc'
    return
  }
  if (!putawayReadyLines.value.length) {
    ElMessage.warning('暂无待上架明细')
    return
  }
  workStep.value = 'putaway'
  await loadLocations()
  putawaySelectedItemId.value = putawayReadyLines.value[0].id
  putawayQty.value = putawayReadyLines.value[0].remaining
  focusPutawayScan()
}

const controlVisible = ref(false)
const controlKind = ref<WarehouseControlKind>('resolve-exception')
const controlChoices = computed(() => warehouseControlOptions(activeOrder.value, permission => app.hasPerm(permission)))
function openControl(kind: WarehouseControlKind) {
  if (receivingLocked.value || !activeOrder.value) return
  controlKind.value = kind; warehouseOperationError.value = ''; controlVisible.value = true
}
function resolveAndPutaway() { openControl('resolve-exception') }
async function submitControl(data: { kind: WarehouseControlKind; order: any; payload: any }) {
  if (warehouseBusy.value || pendingWarehouseAttempt.value || warehouseAttemptError.value) return false
  activeOrder.value = data.order; activeOrderId.value = Number(data.order.id); orderReadError.value = ''
  return beginWarehouseOperation(data.kind, data.payload)
}
async function retryControl(id: number) {
  const attempt = warehouseAttempts.value.find(row => row.inboundId === id)
  if (!attempt) return false
  await postWarehouseOperation(attempt)
  return !warehouseOperationError.value && !warehouseAttempts.value.some(row => row.inboundId === id)
}

function scanTypeLabel(type: string) {
  if (type === 'warehouse_no') return '入仓号'
  if (type === 'tracking_no') return '跟踪号'
  return '入库单号'
}

watch(warehouseCode, () => {
  loadRecent()
  loadActiveOrderList()
})

watch(putawaySelectedItemId, (id) => {
  const line = putawayLines.value.find((i: any) => i.id === id)
  if (line) putawayQty.value = line.remaining
})

watch(workStep, (step) => {
  if (step === 'receive') focusBoxScan()
  if (step === 'qc') focusQcScan()
  if (step === 'putaway') focusPutawayScan()
})

onMounted(async () => {
  refreshWarehouseAttempts()
  await loadWarehouses()
  await loadRecent()
  await loadActiveOrderList()

  const inboundId = Number(route.query.inboundId)
  const step = route.query.step as string | undefined
  if (inboundId > 0) {
    const preferred = step === 'putaway'
      ? 'putaway'
      : step === 'measure' || step === 'qc'
        ? 'qc'
        : undefined
    await loadActiveOrder(inboundId, preferred)
    if (step === 'putaway' && activeOrder.value?.status === 'pending_putaway' && !orderNeedsMeasure(activeOrder.value)) workStep.value = 'putaway'
  } else {
    focusScan()
  }
})
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">海外仓到仓扫描</span>
        <el-button size="small" :disabled="pageBusy" @click="returnToReceipt">返回入库单管理</el-button>
        <el-select
          v-model="warehouseCode"
          placeholder="操作仓库"
          size="small"
          style="width: 280px"
          :disabled="pageBusy"
        >
          <el-option
            v-for="wh in overseasWarehouses"
            :key="wh.warehouseCode"
            :label="`${wh.warehouseName || wh.warehouseCode} (${wh.warehouseCode})`"
            :value="wh.warehouseCode"
          />
        </el-select>
      </div>
    </template>

    <div class="callout info">
      <div class="callout-title">到仓 → 确认箱数 → 清点与测量 → 扫码上架</div>
      <div class="callout-body">
        扫箱收货只登记到仓外箱数量（1 SKU 一箱或一箱多件均在下一环节扫 SKU 清点数）；清点与测量再确认件数并录入体积。
      </div>
    </div>

    <el-alert v-if="referenceReadError" :title="referenceReadError" type="error" :closable="false"><el-button @click="loadWarehouses">重新读取仓库</el-button></el-alert>
    <el-alert v-if="recentReadError" :title="recentReadError" type="warning" :closable="false"><el-button @click="loadRecent">刷新扫描记录</el-button></el-alert>
    <el-alert v-if="orderListReadError" :title="orderListReadError" type="warning" :closable="false"><el-button @click="loadActiveOrderList">刷新作业单</el-button></el-alert>
    <el-alert v-if="locationReadError" :title="locationReadError" type="error" :closable="false"><el-button @click="loadLocations()">重新读取可用库位</el-button></el-alert>
    <el-alert v-if="warehouseAttemptError" :title="warehouseAttemptError" type="error" :closable="false"><el-button @click="refreshWarehouseAttempts">重新读取核对信息</el-button></el-alert>
    <el-alert v-for="attempt in warehouseAttempts" :key="attempt.payload.clientRequestId" type="warning" :closable="false" style="margin-bottom:10px" :title="`仓库作业待核对：${attempt.inboundNo}`">
      <el-button :disabled="pageBusy" @click="restoreWarehouseAttempt(attempt)">恢复原操作</el-button>
      <el-button :loading="warehouseBusy" @click="postWarehouseOperation(attempt)">核对并重试原操作</el-button>
    </el-alert>
    <el-alert v-if="warehouseOperationError" :title="warehouseOperationError" type="error" :closable="false" style="margin-bottom:10px" />
    <el-alert v-if="warehouseResult" :type="warehouseResult.feePending || warehouseResult.syncPending ? 'warning' : 'success'" :closable="false" style="margin-bottom:10px" :title="`${warehouseResult.inboundNo}：${warehouseResult.message || '作业已保存'}`">
      <el-button :disabled="pageBusy" @click="returnToReceipt">返回入库单管理</el-button>
    </el-alert>
    <el-alert v-if="orderReadError" :title="orderReadError" type="error" :closable="false"><el-button :disabled="pageBusy || !activeOrderId" @click="loadActiveOrder(Number(activeOrderId), workStep)">重新读取最新单据</el-button></el-alert>
    <el-alert v-if="activeOrder?.status === 'pending_putaway' && orderNeedsMeasure(activeOrder)" title="该单已完成清点，请先确认并保存实测尺寸，再继续上架" type="info" :closable="false" />
    <el-steps :active="stepActiveIndex" simple class="flow-steps">
      <el-step title="到仓扫描" />
      <el-step title="确认箱数" />
      <el-step title="清点与测量" />
      <el-step title="扫码上架" />
    </el-steps>

    <!-- 选择作业单 -->
    <div class="work-picker">
      <span class="picker-label">作业入库单</span>
      <el-select
        v-model="activeOrderId"
        placeholder="选择或扫描到仓后自动选中"
        clearable
        filterable
        style="width: 320px"
        size="small"
        :disabled="loadingOrder || pageBusy"
        @change="changeActiveOrder"
      >
        <el-option
          v-for="o in activeOrderChoices"
          :key="o.id"
          :label="`${o.inboundNo} · ${INBOUND_STATUS[o.displayStatus || o.status]?.label || '待核对'}`"
          :value="o.id"
        />
      </el-select>
      <el-button-group size="small">
        <el-button :type="workStep === 'arrival' ? 'primary' : 'default'" :disabled="pageBusy" @click="workStep = 'arrival'">到仓</el-button>
        <el-button
          :type="workStep === 'receive' ? 'primary' : 'default'"
          :disabled="!activeOrder || pageBusy"
          @click="workStep = 'receive'"
        >确认箱数</el-button>
        <el-button
          :type="workStep === 'qc' ? 'primary' : 'default'"
          :disabled="pageBusy || !canShowQcStep(activeOrder)"
          @click="goToQcStep"
        >清点</el-button>
        <el-button
          :type="workStep === 'putaway' ? 'primary' : 'default'"
          :disabled="!activeOrder || !['pending_putaway','exception','completed'].includes(activeOrder?.status)"
          @click="goPutawayStep"
        >{{ ['completed', 'confirmed'].includes(activeOrder?.status) ? '上架结果' : '上架' }}</el-button>
      </el-button-group>
    </div>

    <div v-if="activeOrder && controlChoices.length" style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">
      <el-button v-for="kind in controlChoices" :key="kind" size="small" :disabled="receivingLocked" @click="openControl(kind)">{{ ({ 'resolve-exception': '放行上架', 'reopen-count': '更正清点', 'close-zero': '零收货结束', 'reduce-qc': '减少实收件数', 'reduce-carton': '减少实收箱数', 'reduce-putaway': '撤回最近上架' })[kind] }}</el-button>
    </div>
    <WarehouseControlDialog v-model="controlVisible" :inbound-id="activeOrderId" :initial-kind="controlKind" :busy="warehouseBusy" :attempt="pendingWarehouseAttempt" :error-text="warehouseOperationError || warehouseAttemptError" :submit-action="submitControl" :retry-action="retryControl" />

    <!-- 到仓扫描 -->
    <div v-show="workStep === 'arrival'" class="panel">
      <el-form label-width="88px" @submit.prevent="submitArrivalScan">
        <el-form-item label="扫描单号" required>
          <div class="scan-row">
            <el-input
              ref="scanInputRef"
              v-model="scanCode"
              placeholder="只扫入库单号"
              clearable
              :disabled="!canScan || scanning"
              @keyup.enter="submitArrivalScan"
            />
            <el-button type="primary" :loading="scanning" :disabled="!canScan" @click="submitArrivalScan">
              确认到仓
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <div v-if="lastResult" class="result-box" :class="lastResult.ok ? 'ok' : 'err'">
        <div class="result-msg">{{ displaySkuText(lastResult.message) }}</div>
      </div>
    </div>

    <!-- 确认箱数 -->
    <div v-show="workStep === 'receive'" v-loading="loadingOrder" class="panel">
      <fieldset :disabled="receivingLocked" style="border:0;padding:0;margin:0;min-width:0">
      <template v-if="activeOrder">
        <el-descriptions :column="4" border size="small" class="order-summary">
          <el-descriptions-item label="入库单"><span class="mono">{{ activeOrder.inboundNo }}</span></el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="statusTagType(activeOrder.displayStatus || activeOrder.status)">
              {{ activeStatusLabel }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="入仓号">{{ activeOrder.warehouseNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="实收箱数">
            <strong>{{ activeOrder.receivedCartonCount ?? receiveCartonProgress.confirmed ?? '—' }}</strong>
          </el-descriptions-item>
          <el-descriptions-item v-if="hasOuterCartons" label="应收箱数">
            {{ receiveCartonProgress.expected }}
          </el-descriptions-item>
          <el-descriptions-item v-if="hasOuterCartons" label="已扫外箱">
            {{ receiveCartonProgress.scanned }}
          </el-descriptions-item>
          <el-descriptions-item label="应收件数" :span="hasOuterCartons ? 1 : 2">
            {{ receiveProgress.expected }}（下一环节清点）
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="canReceive && ['arrived','receiving'].includes(activeOrder.status)" class="scan-block manual-carton-block">
          <div class="scan-block-title">确认实收箱数</div>
          <el-alert v-if="receiveCartonProgress.confirmed > 0" type="success" :closable="false" show-icon style="margin-bottom:12px" :title="`箱数已确认：${receiveCartonProgress.confirmed} 箱。可继续清点与测量；逐箱扫码用于核对外箱标。`" />
          <el-form inline @submit.prevent="submitManualCartonCount">
            <el-form-item label="实收箱数" required>
              <el-input-number
                v-model="manualCartonCount"
                :min="1"
                :max="9999"
                size="small"
                controls-position="right"
                style="width:120px"
              />
            </el-form-item>
            <el-form-item label="差异原因">
              <el-input v-model="manualCartonDifferenceReason" placeholder="箱数有差异时必填" maxlength="500" :disabled="manualCartonSaving" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="manualCartonSaving" @click="submitManualCartonCount">
                确认箱数
              </el-button>
            </el-form-item>
          </el-form>
          <p class="hint">
            人工点数登记到仓外箱总数。无论 1 SKU 一箱还是一箱多件，本环节只确认箱数；SKU 实收件数请在「清点与测量」扫描录入。
          </p>
        </div>

        <div
          v-if="canReceive && hasOuterCartons && ['arrived','receiving'].includes(activeOrder.status)"
          class="scan-block"
        >
          <el-alert type="info" :closable="false" show-icon style="margin-bottom:10px">
            已配置 <strong>{{ activeOrder.cartons.length }}</strong> 个外箱标：可逐箱扫描外箱标核对（每扫 1 次计 1 箱，不写入 SKU 件数）。
          </el-alert>
          <el-form inline @submit.prevent="submitReceiveCartonScan">
            <el-form-item label="扫描外箱标" required>
              <el-input
                ref="boxScanRef"
                v-model="boxScanCode"
                placeholder="外箱标条码"
                style="width:300px"
                clearable
                :disabled="boxScanning"
                @keyup.enter="submitReceiveCartonScan"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" plain :loading="boxScanning" @click="submitReceiveCartonScan">
                确认外箱
              </el-button>
            </el-form-item>
          </el-form>
        </div>

        <el-table
          v-if="hasOuterCartons"
          :data="activeOrder.cartons"
          border
          size="small"
          stripe
          style="margin-bottom:12px"
        >
          <el-table-column prop="boxCode" label="外箱标" width="160">
            <template #default="{ row }"><span class="mono">{{ row.boxCode }}</span></template>
          </el-table-column>
          <el-table-column label="箱内明细" min-width="200">
            <template #default="{ row }">
              <span v-for="(it, idx) in row.items" :key="idx" class="carton-item-tag">
                {{ displaySku(it) }}×{{ it.qty }}<span v-if="Number(idx) < row.items.length - 1">；</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="收货 / 扫码核对" width="190" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.status === 'received'" type="success" size="small">已扫码核对</el-tag>
              <template v-else-if="receiveCartonProgress.confirmed > 0">
                <el-tag type="success" size="small">整单箱数已确认</el-tag>
                <div class="hint">此外箱未扫码核对</div>
              </template>
              <el-tag v-else type="info" size="small">待收</el-tag>
            </template>
          </el-table-column>
        </el-table>

        <el-table :data="activeOrder.items || []" border size="small" stripe>
          <el-table-column prop="sku" label="SKU" min-width="150">
            <template #default="{ row }">
              <div class="sku-cell">
                <span class="mono">{{ displaySku(row) }}</span>
                <span v-if="bound990Text(row)" class="bound-990">已绑 {{ bound990Text(row) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="productName" label="品名" min-width="140" show-overflow-tooltip />
          <el-table-column prop="spec" label="规格" width="88" show-overflow-tooltip>
            <template #default="{ row }">{{ row.spec || '—' }}</template>
          </el-table-column>
          <el-table-column label="应收" width="72" align="right">
            <template #default="{ row }">{{ row.expectedQty }}</template>
          </el-table-column>
          <el-table-column label="装箱参考" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ skuPackingLabel(activeOrder, row.sku) }}</template>
          </el-table-column>
        </el-table>

        <div class="panel-actions">
          <el-button v-if="canQc" type="primary" :disabled="receivingLocked || !cartonReady" @click="goToQcStep">箱数已确认，进入清点与测量</el-button>
          <span v-if="!cartonReady" class="footer-hint">{{ activeOrder.cartonConfirmation?.message || '请先确认实收箱数' }}</span>
        </div>
      </template>
      <el-empty v-else description="请先到仓扫描或选择作业入库单" />
      </fieldset>
    </div>

    <!-- 清点与测量 -->
    <div v-show="workStep === 'qc'" v-loading="loadingOrder" class="panel">
      <fieldset :disabled="receivingLocked" style="border:0;padding:0;margin:0;min-width:0">
      <template v-if="activeOrder && canShowQcStep(activeOrder)">
        <el-alert v-if="activeOrder.status === 'exception'" type="error" :closable="false" show-icon style="margin-bottom:12px">
          该单清点存在异常，请确认后继续测量。
          <el-button v-if="canResolve" link type="primary" @click="resolveAndPutaway">确认并继续</el-button>
        </el-alert>
        <el-alert v-else type="info" :closable="false" show-icon style="margin-bottom:12px">
          本环节确认 SKU 实收件数（支持 1 SKU 一箱扫 1 次、或一箱多件时设置「每次件数」后扫描完整仓库 SKU / 已绑 990 累加，仓库 SKU 见下方明细）；测量机回传长宽高会自动填入（也支持 JSON 或「SKU|长|宽|高」）。确认后点击「提交清点与测量」。
        </el-alert>

        <el-descriptions :column="4" border size="small" class="order-summary">
          <el-descriptions-item label="入库单"><span class="mono">{{ activeOrder.inboundNo }}</span></el-descriptions-item>
          <el-descriptions-item label="目的仓"><span class="mono">{{ activeOrder.warehouseCode || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="实收箱数">{{ activeOrder.receivedCartonCount ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="尺寸已填写">
            {{ qcMeasureSummary.measured }} / {{ qcMeasureSummary.total }} SKU
          </el-descriptions-item>
        </el-descriptions>

        <div class="scan-block">
          <div class="scan-block-title">扫描清点 / 测量</div>
          <el-form inline @submit.prevent="submitQcScan">
            <el-form-item v-if="canEditQcQty" label="每次件数">
              <el-input-number
                v-model="qcScanIncrement"
                :min="1"
                :max="9999"
                size="small"
                controls-position="right"
                style="width:120px"
              />
            </el-form-item>
            <el-form-item label="扫描 SKU" required>
              <el-input
                ref="qcScanRef"
                v-model="qcSkuScan"
                  placeholder="完整仓库 SKU / 已绑 990 / 测量机输出"
                style="width:320px"
                clearable
                :disabled="qcScanning"
                @keyup.enter="submitQcScan"
              />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="qcScanning"
                :disabled="!(canQc || canPutaway)"
                @click="submitQcScan"
              >
                确认扫描
              </el-button>
            </el-form-item>
          </el-form>
          <p v-if="qcSelectedLine" class="hint">
            当前：{{ displaySku(qcSelectedLine) }}<template v-if="bound990Text(qcSelectedLine)"> · 已绑 {{ bound990Text(qcSelectedLine) }}</template> · 实收 {{ qcSelectedLine.actualQty }} / {{ qcSelectedLine.expectedQty }}
            <template v-if="displaySku(qcSelectedLine) !== qcSelectedLine.sku"> · 仓库 SKU：{{ qcSelectedLine.sku }}</template>
            <template v-if="hasDimensions(qcSelectedLine)">
              · {{ qcSelectedLine.lengthCm }}×{{ qcSelectedLine.widthCm }}×{{ qcSelectedLine.heightCm }} cm
            </template>
          </p>
        </div>

        <el-table
          :data="qcLines"
          border
          size="small"
          stripe
          class="qc-measure-table"
          :row-class-name="({ row }: any) => (row.id === qcSelectedItemId ? 'qc-row-active' : '')"
          @row-click="(row: any) => { qcSelectedItemId = row.id }"
        >
          <el-table-column prop="sku" label="SKU" min-width="150" fixed="left">
            <template #default="{ row }">
              <div class="sku-cell">
                <span class="mono">{{ displaySku(row) }}</span>
                <span v-if="displaySku(row) !== row.sku" class="bound-990 mono">仓库 SKU：{{ row.sku }}</span>
                <span v-if="bound990Text(row)" class="bound-990">已绑 {{ bound990Text(row) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="productName" label="品名" min-width="120" show-overflow-tooltip />
          <el-table-column prop="spec" label="规格" width="72" show-overflow-tooltip />
          <el-table-column label="应收" width="64" align="right">
            <template #default="{ row }">{{ row.expectedQty }}</template>
          </el-table-column>
          <el-table-column label="实收确认" width="108" align="center">
            <template #default="{ row }">
              <el-input-number
                v-model="row.actualQty"
                :min="0"
                size="small"
                controls-position="right"
                class="qty-input"
                :disabled="!canEditQcQty"
              />
            </template>
          </el-table-column>
          <el-table-column label="差异" width="56" align="right">
            <template #default="{ row }">
              <span :class="{ 'diff-warn': row.actualQty !== row.expectedQty }">
                {{ row.actualQty - row.expectedQty }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="QC" width="88" align="center">
            <template #default="{ row }">
              <el-select
                v-model="row.qcStatus"
                size="small"
                :disabled="!canEditQcQty"
              >
                <el-option label="通过" value="pass" />
                <el-option label="异常" value="fail" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="长(cm)" width="88" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.lengthCm" :min="0.1" :precision="1" :controls="false" size="small" class="dim-input" />
            </template>
          </el-table-column>
          <el-table-column label="宽(cm)" width="88" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.widthCm" :min="0.1" :precision="1" :controls="false" size="small" class="dim-input" />
            </template>
          </el-table-column>
          <el-table-column label="高(cm)" width="88" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.heightCm" :min="0.1" :precision="1" :controls="false" size="small" class="dim-input" />
            </template>
          </el-table-column>
          <el-table-column label="QC 备注" min-width="100">
            <template #default="{ row }">
              <el-input
                v-model="row.qcRemark"
                size="small"
                placeholder="说明"
                clearable
                :disabled="!canEditQcQty"
              />
            </template>
          </el-table-column>
        </el-table>
        <div v-if="canQc && canEditQcQty" class="qc-footer">
          <el-checkbox v-model="qcAcceptDiff">确认接受数量差异</el-checkbox>
        </div>
        <div class="panel-actions putaway-footer">
          <span class="footer-hint">提交后将保存清点结果与实测尺寸</span>
          <div class="footer-actions">
            <el-button
              v-if="(canQc && ['arrived', 'receiving'].includes(activeOrder.status)) || (canPutaway && activeOrder.status === 'pending_putaway')"
              type="primary"
              :loading="qcSubmitting"
              @click="submitQcAndMeasure"
            >
              {{ canEditQcQty ? (canPutaway ? '提交清点与测量' : '提交清点') : '保存测量并继续上架' }}
            </el-button>
            <el-button
              v-if="canPutaway && !orderNeedsMeasure(activeOrder) && activeOrder.status === 'pending_putaway'"
              @click="goPutawayStep"
            >
              进入扫码上架
            </el-button>
          </div>
        </div>
      </template>
      <el-empty v-else-if="activeOrder" description="当前状态无需清点与测量，请进入扫码上架" />
      <el-empty v-else description="请选择作业入库单" />
      </fieldset>
    </div>

    <!-- 扫码上架 -->
    <div v-show="workStep === 'putaway'" v-loading="loadingOrder" class="panel">
      <fieldset :disabled="receivingLocked" style="border:0;padding:0;margin:0;min-width:0">
      <template v-if="activeOrder">
        <el-alert v-if="activeOrder.status === 'exception'" type="error" :closable="false" show-icon style="margin-bottom:12px">
          该单清点存在异常，请确认后继续上架。
          <el-button v-if="canResolve" link type="primary" @click="resolveAndPutaway">确认并继续</el-button>
        </el-alert>

        <el-descriptions :column="3" border size="small" class="order-summary">
          <el-descriptions-item label="入库单"><span class="mono">{{ activeOrder.inboundNo }}</span></el-descriptions-item>
          <el-descriptions-item label="目的仓"><span class="mono">{{ activeOrder.warehouseCode || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="入仓号">{{ activeOrder.warehouseNo || '—' }}</el-descriptions-item>
        </el-descriptions>

        <template v-if="activeOrder.status === 'pending_putaway' && putawayReadyLines.length">
          <div class="putaway-section-head">
            <span>待上架明细（{{ putawaySummary.sku }} SKU · {{ putawaySummary.qty }} 件）</span>
            <span class="hint-inline">扫描或选择库位后提交</span>
          </div>

          <el-alert
            v-if="measureSummary.pending > 0"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom:12px"
          >
            还有 {{ measureSummary.pending }} 个 SKU 未完成清点与测量。
            <el-button link type="primary" @click="goToQcStep">去清点与测量</el-button>
          </el-alert>

          <div class="scan-block">
            <div class="scan-block-title">扫码快捷录入</div>
            <el-form label-width="72px" @submit.prevent="submitPutawayScan">
              <el-form-item label="SKU">
                <el-select
                  v-model="putawaySelectedItemId"
                  filterable
                  placeholder="选择或扫描完整仓库 SKU / 已绑 990"
                  style="width:260px"
                  size="small"
                >
                  <el-option
                    v-for="line in putawayReadyLines"
                    :key="line.id"
                    :label="bound990Text(line) ? `${displaySku(line)} / ${bound990Text(line)}（待上架 ${line.remaining}）` : `${displaySku(line)}（待上架 ${line.remaining}）`"
                    :value="line.id"
                  />
                </el-select>
                <el-input
                  ref="putawayScanRef"
                  v-model="putawaySkuScan"
                  placeholder="扫描完整仓库 SKU 或已绑 990"
                  style="width:200px;margin-left:8px"
                  size="small"
                  clearable
                  @keyup.enter="onPutawaySkuScan"
                />
              </el-form-item>
              <el-form-item label="货架号">
                <el-input
                  ref="locationScanRef"
                  v-model="putawayLocationScan"
                  placeholder="扫描货架号，回车填入当前 SKU"
                  style="width:260px"
                  size="small"
                  clearable
                  @keyup.enter="onPutawayLocationScan"
                />
                <span class="hint-inline">也可在下方卡片中手动选择库位</span>
              </el-form-item>
              <el-form-item label="上架数量">
                <el-input-number
                  v-model="putawayQty"
                  :min="1"
                  :max="putawaySelectedLine?.remaining || 99999"
                  size="small"
                  controls-position="right"
                  style="width:120px"
                />
                <span v-if="putawaySelectedLine" class="hint-inline">
                  当前 SKU 最多 {{ putawaySelectedLine.remaining }} 件
                </span>
              </el-form-item>
              <el-form-item>
                <el-button v-if="canPutaway" type="primary" size="small" :loading="warehouseBusy" @click="submitPutawayScan">
                  确认当前 SKU 上架
                </el-button>
              </el-form-item>
            </el-form>
          </div>

          <div class="sku-cards">
            <div
              v-for="(line, idx) in putawayReadyLines"
              :key="line.id"
              class="sku-card"
              :class="{ 'sku-card--active': line.id === putawaySelectedItemId }"
              @click="putawaySelectedItemId = line.id"
            >
              <div class="sku-card-head">
                <div class="sku-card-title">
                  <span class="sku-index">{{ idx + 1 }}</span>
                  <span class="mono sku-code">{{ displaySku(line) }}</span>
                  <span v-if="displaySku(line) !== line.sku" class="bound-990 mono">仓库 SKU：{{ line.sku }}</span>
                  <span v-if="bound990Text(line)" class="bound-990">已绑 {{ bound990Text(line) }}</span>
                  <span v-if="line.productName" class="sku-name">{{ line.productName }}</span>
                </div>
                <div class="sku-qty-tags">
                  <el-tag size="small" type="info">实收 {{ line.actualQty }}</el-tag>
                  <el-tag v-if="line.putawayQty > 0" size="small">已上架 {{ line.putawayQty }}</el-tag>
                  <el-tag size="small" type="warning">待上架 {{ line.remaining }}</el-tag>
                  <el-tag size="small" type="success">{{ line.lengthCm }}×{{ line.widthCm }}×{{ line.heightCm }} cm</el-tag>
                </div>
              </div>
              <div class="sku-card-body sku-card-body--putaway">
                <div class="field-group field-group--location">
                  <div class="field-group-label">目标库位</div>
                  <el-select
                    v-model="line.locationCode"
                    filterable
                    allow-create
                    default-first-option
                    placeholder="选择或搜索库位"
                    size="small"
                    style="width:100%"
                  >
                    <el-option
                      v-for="loc in locationOptions"
                      :key="loc.id"
                      :label="loc.locationCode || loc.code"
                      :value="loc.locationCode || loc.code"
                    />
                  </el-select>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-actions putaway-footer">
            <span class="footer-hint">提交后将写入库位库存</span>
            <el-button v-if="canPutaway" type="primary" :loading="warehouseBusy" @click="submitPutawayAll">
              确认全部上架
            </el-button>
          </div>
        </template>
        <el-empty v-else-if="activeOrder.status === 'pending_putaway' && putawayDraftLines.length && !putawayReadyLines.length" description="请先完成清点与测量">
          <el-button type="primary" @click="goToQcStep">去清点与测量</el-button>
        </el-empty>
        <el-empty v-else-if="activeOrder.status === 'completed'" description="该入库单已上架完成" />
        <el-empty v-else description="暂无待上架明细，请先完成清点" />
      </template>
      <el-empty v-else description="请选择作业入库单，或从下方最近到仓记录继续作业" />
      </fieldset>
    </div>

    <!-- 最近扫描 -->
    <div class="recent-section">
      <div class="section-title">最近到仓记录</div>
      <el-table v-loading="loadingRecent" :data="recentScans" stripe border size="small">
        <el-table-column prop="scannedAt" label="时间" width="120" />
        <el-table-column prop="inboundNo" label="入库单" width="140">
          <template #default="{ row }"><span class="mono">{{ row.inboundNo }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.status)">
              {{ INBOUND_STATUS[row.status]?.label || '待核对' || '—' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="warehouseNo" label="入仓号" width="120" />
        <el-table-column prop="scanCode" label="扫描码" min-width="160" show-overflow-tooltip>
          <template #default="{ row }"><span class="mono">{{ row.scanCode }}</span></template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ scanTypeLabel(row.scanType) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="loadActiveOrder(row.inboundId)">{{ ['completed', 'confirmed', 'cancelled'].includes(row.status) ? '查看结果' : '继续作业' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-card>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.page-title { font-weight: 600; font-size: 15px; }
.callout { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
.callout.info { background: #eef6ff; border: 1px solid #c5dff8; color: #3d4f63; }
.callout-title { font-weight: 600; margin-bottom: 4px; }
.flow-steps { margin-bottom: 16px; }
.work-picker { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.picker-label { font-size: 13px; color: var(--el-text-color-secondary); }
.panel { margin-bottom: 24px; }
.scan-row { display: flex; gap: 8px; width: 100%; max-width: 560px; }
.scan-row .el-input { flex: 1; }
.scan-block { margin-bottom: 12px; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
.manual-carton-block { margin-bottom: 12px; }
.manual-carton-block .hint { margin: 0; }
.hint { font-size: 12px; color: var(--el-text-color-secondary); margin: 4px 0 0; }
.hint-inline { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.result-box { margin-top: 8px; padding: 12px; border-radius: 8px; font-size: 13px; max-width: 560px; }
.result-box.ok { background: #f0f9eb; border: 1px solid #c2e7b0; }
.result-box.err { background: #fef0f0; border: 1px solid #fbc4c4; }
.order-summary { margin-bottom: 12px; }
.panel-actions { margin-top: 12px; }
.qc-footer { margin-top: 12px; font-size: 13px; }
.qty-input { width: 100%; max-width: 108px; }
.dim-input { width: 100%; max-width: 72px; }
.qc-measure-table :deep(.el-input-number) { width: 100%; }
.qc-measure-table :deep(.qc-row-active > td) {
  background: var(--el-color-primary-light-9) !important;
}
.diff-warn { color: var(--el-color-warning); font-weight: 600; }
.recent-section { margin-top: 8px; border-top: 1px solid var(--el-border-color-lighter); padding-top: 16px; }
.section-title { font-weight: 600; font-size: 14px; margin-bottom: 10px; }
.mono { font-family: var(--font-mono, Consolas, monospace); font-size: 12px; }
.carton-item-tag { font-size: 12px; }

.putaway-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
}

.scan-block-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.sku-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.sku-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
}

.sku-card--active {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-7);
}

.sku-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.sku-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.sku-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  flex-shrink: 0;
}

.sku-code { font-weight: 600; }

.sku-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bound-990 {
  font-size: 11px;
  color: var(--el-color-warning);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.sku-name {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sku-qty-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.sku-card-body {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 14px;
  padding: 12px;
}

.field-group-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.dim-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.dim-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dim-field label {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.dim-field :deep(.el-input-number) { width: 100%; }

.field-group--location {
  display: flex;
  flex-direction: column;
}

.putaway-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.footer-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
  .sku-card-body { grid-template-columns: 1fr; }
  .putaway-footer { flex-direction: column; align-items: stretch; }
}
</style>
