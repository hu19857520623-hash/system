<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { inboundApi, warehouseApi, locationApi } from '@/api/client.js'
import { mapWarehouse } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'
import { INBOUND_STATUS } from '@/constants/index.js'
import { withAction } from '@/composables/useListLoader.ts'

const app = useAppStore()
const route = useRoute()

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
const workStep = ref<WorkStep>('arrival')
const activeOrders = ref<any[]>([])

/** 扫箱收货 */
const manualCartonCount = ref<number | null>(null)
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
const putawaySubmitting = ref(false)

const canScan = computed(() => app.hasPerm('inbound.arrival_scan'))
const canReceive = computed(() => app.hasPerm('inbound.receive'))
const canQc = computed(() => app.hasPerm('inbound.qc'))
const canPutaway = computed(() => app.hasPerm('inbound.putaway'))
const canResolve = computed(() => app.hasPerm('inbound.handle_exception') || app.hasPerm('inbound.confirm_diff'))

const activeStatusLabel = computed(() => {
  const o = activeOrder.value
  if (!o) return '—'
  const key = o.displayStatus || o.status
  return INBOUND_STATUS[key]?.label || o.status || '—'
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
  const confirmed = order?.receivedCartonCount ?? manualCartonCount.value ?? null
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
  const measured = pending.filter((l) => hasDimensions(l))
  return {
    total: pending.length,
    measured: measured.length,
    pending: pending.length - measured.length,
  }
})

const putawayReadyLines = computed(() => putawayDraftLines.value.filter((l) => hasDimensions(l)))

function hasDimensions(line: { lengthCm?: number; widthCm?: number; heightCm?: number }) {
  return [line.lengthCm, line.widthCm, line.heightCm].every((v) => Number(v) > 0)
}

function orderNeedsMeasure(order: any) {
  return (order?.items || []).some((item: any) => {
    const actual = item.actualQty ?? item.expectedQty
    const remaining = actual - (item.putawayQty ?? 0)
    return remaining > 0 && !hasDimensions(item)
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
  return order.status === 'pending_putaway' && orderNeedsMeasure(order)
}

const canEditQcQty = computed(() =>
  !!activeOrder.value && ['arrived', 'receiving'].includes(activeOrder.value.status),
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
        productName: item.productName || '',
        actualQty: actual,
        putawayQty: item.putawayQty ?? 0,
        remaining,
        locationCode: '',
        lengthCm: item.lengthCm ?? undefined,
        widthCm: item.widthCm ?? undefined,
        heightCm: item.heightCm ?? undefined,
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
  try {
    const res = await warehouseApi.list({ type: 'overseas' })
    overseasWarehouses.value = (Array.isArray(res) ? res : res.items || []).map(mapWarehouse)
    if (!warehouseCode.value && overseasWarehouses.value.length) {
      warehouseCode.value = overseasWarehouses.value[0].warehouseCode
    }
  } catch {
    overseasWarehouses.value = []
  }
}

async function loadRecent() {
  if (!warehouseCode.value) {
    recentScans.value = []
    return
  }
  loadingRecent.value = true
  try {
    const rows = await inboundApi.listArrivalScans({ warehouseCode: warehouseCode.value, limit: 30 })
    recentScans.value = Array.isArray(rows) ? rows : []
  } catch {
    recentScans.value = []
  } finally {
    loadingRecent.value = false
  }
}

async function loadActiveOrderList() {
  if (!warehouseCode.value) {
    activeOrders.value = []
    return
  }
  try {
    const res = await inboundApi.list({ pageSize: 100 })
    const rows = res.items || []
    activeOrders.value = rows.filter((o: any) =>
      o.warehouseCode === warehouseCode.value
      && ['arrived', 'receiving', 'pending_putaway', 'exception'].includes(o.status),
    )
  } catch {
    activeOrders.value = []
  }
}

async function loadActiveOrder(id: number, preferredStep?: WorkStep) {
  loadingOrder.value = true
  try {
    const data = await inboundApi.detail(id)
    activeOrderId.value = id
    activeOrder.value = data
    buildQcLines(data)
    workStep.value = preferredStep || deriveWorkStep(data)
    buildPutawayDraft(data)
    syncManualCartonCount(data)
    if (workStep.value === 'putaway') {
      await loadLocations(data.warehouseCode)
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载入库单失败')
  } finally {
    loadingOrder.value = false
  }
}

async function loadLocations(wh?: string) {
  const code = wh || activeOrder.value?.warehouseCode
  if (!code) return
  try {
    const rows = await locationApi.list({ warehouseCode: code, status: 'available' })
    locationOptions.value = Array.isArray(rows) ? rows : rows.items || []
  } catch {
    locationOptions.value = []
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

async function submitQcScan() {
  if (!activeOrder.value) return
  if (!canQc.value && !canPutaway.value) return
  const code = qcSkuScan.value.trim()
  if (!code) {
    ElMessage.warning('请扫描 SKU')
    return
  }
  qcScanning.value = true
  try {
    const res = await inboundApi.scanQc(activeOrder.value.id, {
      scanCode: code,
      increment: qcScanIncrement.value,
    })
    await loadActiveOrder(activeOrder.value.id, 'qc')
    qcSelectedItemId.value = res.itemId ?? qcSelectedItemId.value
    ElMessage.success(res.message || '扫描成功')
    qcSkuScan.value = ''
    focusQcScan()
  } catch (e: any) {
    ElMessage.error(e?.message || '扫描清点失败')
    focusQcScan()
  } finally {
    qcScanning.value = false
  }
}

async function submitArrivalScan() {
  if (!canScan.value) return
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
      ElMessage.info(res.message || '该单已到仓')
    } else {
      ElMessage.success(res.message || '到仓扫描成功')
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
    lastResult.value = { ok: false, message: e?.message || '扫描失败' }
    ElMessage.error(e?.message || '扫描失败')
    focusScan()
  } finally {
    scanning.value = false
  }
}

async function submitReceiveCartonScan() {
  if (!canReceive.value || !activeOrder.value) return
  const code = boxScanCode.value.trim()
  if (!code) {
    ElMessage.warning('请扫描外箱标')
    return
  }
  boxScanning.value = true
  try {
    const res = await inboundApi.receiveBox(activeOrder.value.id, { scanCode: code })
    ElMessage.success(res.message || '外箱已确认')
    boxScanCode.value = ''
    await loadActiveOrder(activeOrder.value.id, 'receive')
    focusBoxScan()
  } catch (e: any) {
    ElMessage.error(e?.message || '扫描外箱失败')
    focusBoxScan()
  } finally {
    boxScanning.value = false
  }
}

async function submitManualCartonCount() {
  if (!canReceive.value || !activeOrder.value) return
  const count = Math.floor(Number(manualCartonCount.value))
  if (!Number.isFinite(count) || count <= 0) {
    ElMessage.warning('实收箱数须大于 0')
    return
  }
  manualCartonSaving.value = true
  try {
    const res = await inboundApi.recordReceivedCartonCount(activeOrder.value.id, { receivedCartonCount: count })
    ElMessage.success(res.message || '实收箱数已保存')
    await loadActiveOrder(activeOrder.value.id, 'receive')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存实收箱数失败')
  } finally {
    manualCartonSaving.value = false
  }
}

function goToQcStep() {
  if (!activeOrder.value) return
  if (!canShowQcStep(activeOrder.value)) {
    ElMessage.warning('当前状态不可清点与测量')
    return
  }
  const confirmed = activeOrder.value.receivedCartonCount ?? manualCartonCount.value
  if (!confirmed || confirmed <= 0) {
    ElMessage.warning('请先在「确认箱数」环节登记实收箱数')
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
  if (!activeOrder.value) return
  const order = activeOrder.value

  if (order.status === 'exception') {
    ElMessage.warning('该单处于异常状态，请先点击「异常放行」')
    return
  }

  for (const line of qcLines.value) {
    if (!validateMeasureLine(line)) return
  }

  const measureItems = qcLines.value.map(measurePayloadFromQcLine)
  const needsQc = ['arrived', 'receiving'].includes(order.status)

  if (needsQc) {
    if (!canQc.value) {
      ElMessage.warning('无清点权限')
      return
    }
    qcSubmitting.value = true
    const qcOk = await withAction(async () => {
      await inboundApi.qc(order.id, {
        acceptDiff: qcAcceptDiff.value,
        items: qcLines.value.map((l) => ({
          id: l.id,
          sku: l.sku,
          actualQty: l.actualQty,
          qcStatus: l.qcStatus,
          qcRemark: l.qcRemark || undefined,
        })),
      })
    }, `${order.inboundNo} 清点已提交`)
    qcSubmitting.value = false
    if (!qcOk) return

    const refreshed = await inboundApi.detail(order.id)
    activeOrder.value = refreshed
    if (refreshed.status === 'exception') {
      buildQcLines(refreshed)
      ElMessage.warning('清点存在异常或数量差异，需主管放行后继续测量')
      return
    }
  } else if (order.status !== 'pending_putaway') {
    ElMessage.warning('当前状态不可提交清点与测量')
    return
  }

  if (!canPutaway.value) {
    ElMessage.warning('无测量权限')
    return
  }

  qcSubmitting.value = true
  const measureOk = await withAction(async () => {
    const data = await inboundApi.measureDimensions(activeOrder.value.id, { items: measureItems })
    activeOrder.value = data
    buildQcLines(data)
    buildPutawayDraft(data)
    await loadActiveOrderList()
    await loadRecent()
  }, `${activeOrder.value.inboundNo} 清点与测量已保存`)
  qcSubmitting.value = false

  if (measureOk && !orderNeedsMeasure(activeOrder.value)) {
    ElMessage.success('清点与测量已完成，可进入扫码上架')
    await goPutawayStep()
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

function validateMeasureLine(item: any) {
  if (!hasDimensions(item)) {
    ElMessage.warning(`请为 SKU ${item.sku} 填写有效的长宽高（cm）`)
    return false
  }
  return true
}

function onPutawaySkuScan() {
  const code = putawaySkuScan.value.trim().toUpperCase()
  if (!code) return
  const line = putawayReadyLines.value.find((i: any) => String(i.sku).toUpperCase() === code)
  if (!line) {
    ElMessage.warning(`SKU ${putawaySkuScan.value} 不在待上架明细中`)
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
  const targetQty = qty ?? item.remaining
  if (!hasDimensions(item)) {
    ElMessage.warning(`${item.sku} 请先完成体积测量`)
    return false
  }
  if (!item.locationCode) {
    ElMessage.warning(`请为 SKU ${item.sku} 选择库位`)
    return false
  }
  if (targetQty <= 0 || targetQty > item.remaining) {
    ElMessage.warning(`${item.sku} 上架数量无效（待上架 ${item.remaining}）`)
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
  if (!canPutaway.value || !activeOrder.value || !putawaySelectedLine.value) {
    ElMessage.warning('请选择待上架 SKU')
    return
  }
  if (activeOrder.value.status === 'exception') {
    ElMessage.warning('入库单处于异常状态，请先点击「异常放行」后再上架')
    return
  }
  if (activeOrder.value.status !== 'pending_putaway') {
    ElMessage.warning('当前入库单状态不可上架，请先完成清点')
    return
  }

  applyLocationScanToSelected()
  const line = putawaySelectedLine.value
  const qty = Math.min(Math.max(1, putawayQty.value), line.remaining)
  if (!validatePutawayLine(line, qty)) return

  putawaySubmitting.value = true
  const ok = await withAction(async () => {
    await inboundApi.putaway(activeOrder.value.id, {
      items: [putawayPayloadItem(line, qty)],
    })
    await loadActiveOrder(activeOrder.value.id, 'putaway')
    await loadActiveOrderList()
    await loadRecent()
  }, `${line.sku} → ${resolveLocationCode(line.locationCode)} ×${qty}`)
  putawaySubmitting.value = false

  if (ok) {
    putawayLocationScan.value = ''
    putawaySkuScan.value = ''
    if (putawayReadyLines.value.length) {
      putawaySelectedItemId.value = putawayReadyLines.value[0].id
      putawayQty.value = putawayReadyLines.value[0].remaining
      focusPutawayScan()
    } else {
      ElMessage.success(`${activeOrder.value.inboundNo} 已全部上架完成`)
    }
  }
}

async function submitPutawayAll() {
  if (!canPutaway.value || !activeOrder.value) return
  if (activeOrder.value.status === 'exception') {
    ElMessage.warning('入库单处于异常状态，请先点击「异常放行」后再上架')
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

  putawaySubmitting.value = true
  const ok = await withAction(async () => {
    await inboundApi.putaway(activeOrder.value.id, {
      items: putawayReadyLines.value.map((item) => putawayPayloadItem(item, item.remaining)),
    })
    await loadActiveOrder(activeOrder.value.id, 'putaway')
    await loadActiveOrderList()
    await loadRecent()
  }, `${activeOrder.value.inboundNo} 上架完成`)
  putawaySubmitting.value = false

  if (ok && !putawayDraftLines.value.length) {
    ElMessage.success(`${activeOrder.value.inboundNo} 已全部上架完成`)
  }
}

async function goPutawayStep() {
  if (!activeOrder.value) return
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

async function resolveAndPutaway() {
  if (!activeOrder.value || activeOrder.value.status !== 'exception') return
  const ok = await withAction(async () => {
    await inboundApi.resolveException(activeOrder.value.id)
    await loadActiveOrder(activeOrder.value.id, orderNeedsMeasure(activeOrder.value) ? 'qc' : 'putaway')
  }, '已放行，可继续作业')
  if (ok && workStep.value === 'putaway') await loadLocations()
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
    if (step === 'putaway' || step === 'measure' || step === 'qc') workStep.value = step === 'putaway' ? 'putaway' : 'qc'
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
        <el-select
          v-model="warehouseCode"
          placeholder="操作仓库"
          size="small"
          style="width: 280px"
          @change="activeOrderId = null; activeOrder = null"
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
        @change="(id: number | null) => id && loadActiveOrder(id)"
      >
        <el-option
          v-for="o in activeOrders"
          :key="o.id"
          :label="`${o.inboundNo} · ${INBOUND_STATUS[o.displayStatus || o.status]?.label || o.status}`"
          :value="o.id"
        />
      </el-select>
      <el-button-group size="small">
        <el-button :type="workStep === 'arrival' ? 'primary' : 'default'" @click="workStep = 'arrival'">到仓</el-button>
        <el-button
          :type="workStep === 'receive' ? 'primary' : 'default'"
          :disabled="!activeOrder"
          @click="workStep = 'receive'"
        >确认箱数</el-button>
        <el-button
          :type="workStep === 'qc' ? 'primary' : 'default'"
          :disabled="!canShowQcStep(activeOrder)"
          @click="goToQcStep"
        >清点</el-button>
        <el-button
          :type="workStep === 'putaway' ? 'primary' : 'default'"
          :disabled="!activeOrder || !['pending_putaway','exception','completed'].includes(activeOrder?.status)"
          @click="goPutawayStep"
        >上架</el-button>
      </el-button-group>
    </div>

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
        <div class="result-msg">{{ lastResult.message }}</div>
      </div>
    </div>

    <!-- 确认箱数 -->
    <div v-show="workStep === 'receive'" v-loading="loadingOrder" class="panel">
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
                {{ it.sku }}×{{ it.qty }}<span v-if="Number(idx) < row.items.length - 1">；</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="88" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'received' ? 'success' : 'info'" size="small">
                {{ row.status === 'received' ? '已收' : '待收' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <el-table :data="activeOrder.items || []" border size="small" stripe>
          <el-table-column prop="sku" label="SKU" width="120">
            <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
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
          <el-button v-if="canQc" type="primary" @click="goToQcStep">箱数已确认，进入清点与测量</el-button>
        </div>
      </template>
      <el-empty v-else description="请先到仓扫描或选择作业入库单" />
    </div>

    <!-- 清点与测量 -->
    <div v-show="workStep === 'qc'" v-loading="loadingOrder" class="panel">
      <template v-if="activeOrder && canShowQcStep(activeOrder)">
        <el-alert v-if="activeOrder.status === 'exception'" type="error" :closable="false" show-icon style="margin-bottom:12px">
          该单清点异常，需主管放行后才能继续测量。
          <el-button v-if="canResolve" link type="primary" @click="resolveAndPutaway">异常放行</el-button>
        </el-alert>
        <el-alert v-else type="info" :closable="false" show-icon style="margin-bottom:12px">
          本环节确认 SKU 实收件数（支持 1 SKU 一箱扫 1 次、或一箱多件时设置「每次件数」后扫 SKU 累加）；测量机回传长宽高会自动填入（也支持 JSON 或「SKU|长|宽|高」）。确认后点击「提交清点与测量」。
        </el-alert>

        <el-descriptions :column="4" border size="small" class="order-summary">
          <el-descriptions-item label="入库单"><span class="mono">{{ activeOrder.inboundNo }}</span></el-descriptions-item>
          <el-descriptions-item label="目的仓"><span class="mono">{{ activeOrder.warehouseCode || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="实收箱数">{{ activeOrder.receivedCartonCount ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="测量进度">
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
                placeholder="SKU 标签 / 测量机输出"
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
            当前：{{ qcSelectedLine.sku }} · 实收 {{ qcSelectedLine.actualQty }} / {{ qcSelectedLine.expectedQty }}
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
          <el-table-column prop="sku" label="SKU" width="118" fixed="left">
            <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
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
        <div v-if="canResolve && canEditQcQty" class="qc-footer">
          <el-checkbox v-model="qcAcceptDiff">确认接受数量差异（需主管权限）</el-checkbox>
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
              提交清点与测量
            </el-button>
            <el-button
              v-if="qcMeasureSummary.pending === 0 && activeOrder.status === 'pending_putaway'"
              @click="goPutawayStep"
            >
              进入扫码上架
            </el-button>
          </div>
        </div>
      </template>
      <el-empty v-else-if="activeOrder" description="当前状态无需清点与测量，请进入扫码上架" />
      <el-empty v-else description="请选择作业入库单" />
    </div>

    <!-- 扫码上架 -->
    <div v-show="workStep === 'putaway'" v-loading="loadingOrder" class="panel">
      <template v-if="activeOrder">
        <el-alert v-if="activeOrder.status === 'exception'" type="error" :closable="false" show-icon style="margin-bottom:12px">
          该单清点异常，需主管放行后才能上架。
          <el-button v-if="canResolve" link type="primary" @click="resolveAndPutaway">放行上架</el-button>
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
                  placeholder="选择或扫描 SKU"
                  style="width:260px"
                  size="small"
                >
                  <el-option
                    v-for="line in putawayReadyLines"
                    :key="line.id"
                    :label="`${line.sku}（待上架 ${line.remaining}）`"
                    :value="line.id"
                  />
                </el-select>
                <el-input
                  ref="putawayScanRef"
                  v-model="putawaySkuScan"
                  placeholder="扫描 SKU 快速选中"
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
                <el-button v-if="canPutaway" type="primary" size="small" :loading="putawaySubmitting" @click="submitPutawayScan">
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
                  <span class="mono sku-code">{{ line.sku }}</span>
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
            <el-button v-if="canPutaway" type="primary" :loading="putawaySubmitting" @click="submitPutawayAll">
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
              {{ INBOUND_STATUS[row.status]?.label || row.status || '—' }}
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
            <el-button link type="primary" size="small" @click="loadActiveOrder(row.inboundId)">继续作业</el-button>
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
