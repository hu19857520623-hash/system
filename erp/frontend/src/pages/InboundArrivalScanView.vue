<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { inboundApi, warehouseApi, locationApi } from '@/api/client.js'
import { mapWarehouse, fmtTime } from '@/api/mappers.ts'
import { useAppStore } from '@/stores/app'
import { INBOUND_STATUS } from '@/constants/index.js'
import { withAction } from '@/composables/useListLoader.ts'

const app = useAppStore()
const route = useRoute()

type WorkStep = 'arrival' | 'receive' | 'qc' | 'measure' | 'putaway'

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
const boxQty = ref(1)
const boxScanCode = ref('')
const boxScanning = ref(false)
const boxScanRef = ref<{ focus: () => void } | null>(null)

/** 人工清点 */
const qcLines = ref<any[]>([])
const qcAcceptDiff = ref(false)

/** 测量体积 & 扫码上架 */
const measureSelectedItemId = ref<number | null>(null)
const measureSkuScan = ref('')
const measureScanRef = ref<{ focus: () => void } | null>(null)
const measureSubmitting = ref(false)
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

const hasOuterCartons = computed(() => (activeOrder.value?.cartons?.length ?? 0) > 0)
const pendingCartons = computed(() =>
  (activeOrder.value?.cartons || []).filter((c: any) => c.status === 'pending'),
)
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

const measureSelectedLine = computed(() =>
  putawayDraftLines.value.find((i: any) => i.id === measureSelectedItemId.value) || null,
)

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

const stepActiveIndex = computed(() => {
  const map: Record<WorkStep, number> = { arrival: 0, receive: 1, qc: 2, measure: 3, putaway: 4 }
  return map[workStep.value] ?? 0
})

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
    measureSelectedItemId.value = putawayDraftLines.value.find((l) => !hasDimensions(l))?.id
      ?? putawayDraftLines.value[0].id
  } else {
    putawaySelectedItemId.value = null
    measureSelectedItemId.value = null
    putawayQty.value = 1
  }
}

function buildPutawayDraftFromActive() {
  if (activeOrder.value) buildPutawayDraft(activeOrder.value)
}

function parseCustomerRemark(remark?: string | null) {
  const raw = remark || ''
  return raw
    .replace(/\[.*?\]/g, '')
    .replace(/入仓:[^\s]+/g, '')
    .replace(/到货:\d{4}-\d{2}-\d{2}/g, '')
    .replace(/海运:[^\s]+/g, '')
    .replace(/承运:[^\s]+/g, '')
    .replace(/运单:[^\s]+/g, '')
    .trim() || '—'
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
    return orderNeedsMeasure(order) ? 'measure' : 'putaway'
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
  }))
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

function focusMeasureScan() {
  nextTick(() => measureScanRef.value?.focus())
}

function focusPutawayScan() {
  nextTick(() => putawayScanRef.value?.focus())
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

async function submitReceiveBox() {
  if (!canReceive.value || !activeOrder.value) return
  const code = boxScanCode.value.trim()
  if (!code) {
    ElMessage.warning('请扫描箱标 / SKU')
    return
  }
  boxScanning.value = true
  try {
    const payload: { scanCode: string; qty?: number } = { scanCode: code }
    if (!hasOuterCartons.value) payload.qty = boxQty.value
    const res = await inboundApi.receiveBox(activeOrder.value.id, payload)
    ElMessage.success(res.message || '收货成功')
    boxScanCode.value = ''
    await loadActiveOrder(activeOrder.value.id, 'receive')
    focusBoxScan()
  } catch (e: any) {
    ElMessage.error(e?.message || '扫箱收货失败')
    focusBoxScan()
  } finally {
    boxScanning.value = false
  }
}

function goToQcStep() {
  if (!activeOrder.value) return
  if (!['arrived', 'receiving'].includes(activeOrder.value.status)) {
    ElMessage.warning('当前状态不可清点')
    return
  }
  buildQcLines(activeOrder.value)
  workStep.value = 'qc'
}

async function submitQc() {
  if (!canQc.value || !activeOrder.value) return
  const ok = await withAction(async () => {
    await inboundApi.qc(activeOrder.value.id, {
      acceptDiff: qcAcceptDiff.value,
      items: qcLines.value.map((l) => ({
        id: l.id,
        sku: l.sku,
        actualQty: l.actualQty,
        qcStatus: l.qcStatus,
        qcRemark: l.qcRemark || undefined,
      })),
    })
    await loadActiveOrder(activeOrder.value.id)
    await loadActiveOrderList()
    await loadRecent()
  }, `${activeOrder.value.inboundNo} 清点已提交`)
  if (ok) {
    workStep.value = 'measure'
    buildPutawayDraftFromActive()
    focusMeasureScan()
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

function onMeasureSkuScan() {
  const code = measureSkuScan.value.trim().toUpperCase()
  if (!code) return
  const line = putawayDraftLines.value.find((i: any) => String(i.sku).toUpperCase() === code)
  if (!line) {
    ElMessage.warning(`SKU ${measureSkuScan.value} 不在待测量明细中`)
    return
  }
  measureSelectedItemId.value = line.id
  measureSkuScan.value = ''
}

function validateMeasureLine(item: any) {
  if (!hasDimensions(item)) {
    ElMessage.warning(`请为 SKU ${item.sku} 填写有效的长宽高（cm）`)
    return false
  }
  return true
}

function measurePayloadItem(item: any) {
  return {
    inboundItemId: item.id,
    lengthCm: item.lengthCm,
    widthCm: item.widthCm,
    heightCm: item.heightCm,
  }
}

async function submitMeasureSingle() {
  if (!canPutaway.value || !activeOrder.value || !measureSelectedLine.value) {
    ElMessage.warning('请选择待测量 SKU')
    return
  }
  if (activeOrder.value.status !== 'pending_putaway') {
    ElMessage.warning('当前入库单状态不可测量')
    return
  }
  const line = measureSelectedLine.value
  if (!validateMeasureLine(line)) return

  measureSubmitting.value = true
  const ok = await withAction(async () => {
    const data = await inboundApi.measureDimensions(activeOrder.value.id, {
      items: [measurePayloadItem(line)],
    })
    activeOrder.value = data
    buildPutawayDraft(data)
  }, `${line.sku} 体积已保存`)
  measureSubmitting.value = false

  if (ok && measureSummary.value.pending === 0) {
    ElMessage.success('全部 SKU 已测量，可进入上架')
  }
}

async function submitMeasureAll() {
  if (!canPutaway.value || !activeOrder.value) return
  if (activeOrder.value.status !== 'pending_putaway') {
    ElMessage.warning('当前入库单状态不可测量')
    return
  }
  if (!putawayDraftLines.value.length) {
    ElMessage.warning('暂无待测量明细')
    return
  }
  for (const item of putawayDraftLines.value) {
    if (!validateMeasureLine(item)) return
  }

  measureSubmitting.value = true
  const ok = await withAction(async () => {
    const data = await inboundApi.measureDimensions(activeOrder.value.id, {
      items: putawayDraftLines.value.map(measurePayloadItem),
    })
    activeOrder.value = data
    buildPutawayDraft(data)
  }, `${activeOrder.value.inboundNo} 体积测量已保存`)
  measureSubmitting.value = false

  if (ok) ElMessage.success('可进入「扫码上架」步骤')
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

async function goMeasureStep() {
  if (!activeOrder.value) return
  workStep.value = 'measure'
  buildPutawayDraftFromActive()
  focusMeasureScan()
}

async function goPutawayStep() {
  buildPutawayDraftFromActive()
  if (measureSummary.value.pending > 0) {
    ElMessage.warning(`还有 ${measureSummary.value.pending} 个 SKU 未完成体积测量`)
    workStep.value = 'measure'
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
    await loadActiveOrder(activeOrder.value.id, orderNeedsMeasure(activeOrder.value) ? 'measure' : 'putaway')
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
  if (step === 'measure') focusMeasureScan()
  if (step === 'putaway') focusPutawayScan()
})

onMounted(async () => {
  await loadWarehouses()
  await loadRecent()
  await loadActiveOrderList()

  const inboundId = Number(route.query.inboundId)
  const step = route.query.step as WorkStep | undefined
  if (inboundId > 0) {
    const preferred = step === 'putaway' || step === 'measure' ? step : undefined
    await loadActiveOrder(inboundId, preferred)
    if (step === 'putaway' || step === 'measure') workStep.value = step
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
      <div class="callout-title">到仓 → 扫箱收货 → 人工清点 → 测量体积 → 扫码上架</div>
      <div class="callout-body">
        清点完成后先逐 SKU 测量长宽高（cm）并保存；全部测量完成后，再扫描库位完成上架写入库存。
      </div>
    </div>

    <el-steps :active="stepActiveIndex" simple class="flow-steps">
      <el-step title="到仓扫描" />
      <el-step title="扫箱收货" />
      <el-step title="人工清点" />
      <el-step title="测量体积" />
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
        >收货</el-button>
        <el-button
          :type="workStep === 'qc' ? 'primary' : 'default'"
          :disabled="!activeOrder || !['arrived','receiving','exception'].includes(activeOrder?.status)"
          @click="goToQcStep"
        >清点</el-button>
        <el-button
          :type="workStep === 'measure' ? 'primary' : 'default'"
          :disabled="!activeOrder || !['pending_putaway','exception'].includes(activeOrder?.status)"
          @click="goMeasureStep"
        >测量</el-button>
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
              placeholder="入库单号 / 入仓号 / 跟踪号"
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

    <!-- 扫箱收货 -->
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
          <el-descriptions-item label="收货进度">
            {{ receiveProgress.received }} / {{ receiveProgress.expected }}
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="canReceive && ['arrived','receiving'].includes(activeOrder.status)" class="scan-block">
          <el-alert type="info" :closable="false" show-icon style="margin-bottom:10px">
            <template v-if="hasOuterCartons">
              已配置 <strong>{{ activeOrder.cartons.length }}</strong> 个外箱标：扫<strong>外箱标</strong>按装箱明细整箱收货；扫<strong>SKU 标签</strong>仍可按件累加（备用）。
            </template>
            <template v-else>
              未配置外箱时，扫 <strong>SKU 标签</strong> 并按「每箱件数」累加实收。
            </template>
          </el-alert>
          <el-form inline @submit.prevent="submitReceiveBox">
            <el-form-item v-if="!hasOuterCartons" label="每箱件数">
              <el-input-number v-model="boxQty" :min="1" :max="9999" size="small" controls-position="right" style="width:120px" />
            </el-form-item>
            <el-form-item label="扫描" required>
              <el-input
                ref="boxScanRef"
                v-model="boxScanCode"
                :placeholder="hasOuterCartons ? '外箱标 / SKU 标签' : 'SKU 标签'"
                style="width:300px"
                clearable
                :disabled="boxScanning"
                @keyup.enter="submitReceiveBox"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="boxScanning" @click="submitReceiveBox">确认收货</el-button>
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
                {{ it.sku }}×{{ it.qty }}<span v-if="idx < row.items.length - 1">；</span>
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
          <el-table-column label="已扫收" width="72" align="right">
            <template #default="{ row }"><strong>{{ row.actualQty ?? 0 }}</strong></template>
          </el-table-column>
          <el-table-column label="待收" width="72" align="right">
            <template #default="{ row }">
              {{ Math.max(0, row.expectedQty - (row.actualQty ?? 0)) }}
            </template>
          </el-table-column>
        </el-table>

        <div class="panel-actions">
          <el-button v-if="canQc" type="primary" @click="goToQcStep">扫箱完成，进入人工清点</el-button>
        </div>
      </template>
      <el-empty v-else description="请先到仓扫描或选择作业入库单" />
    </div>

    <!-- 人工清点 -->
    <div v-show="workStep === 'qc'" v-loading="loadingOrder" class="panel">
      <template v-if="activeOrder">
        <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px">
          清点需人工确认实收数量与 QC 结果，扫描收货不会自动提交清点。
        </el-alert>
        <el-table :data="qcLines" border size="small" stripe>
          <el-table-column prop="sku" label="SKU" width="118" fixed="left">
            <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
          </el-table-column>
          <el-table-column prop="productName" label="品名" min-width="130" show-overflow-tooltip />
          <el-table-column prop="spec" label="规格" width="80" show-overflow-tooltip />
          <el-table-column label="应收" width="72" align="right">
            <template #default="{ row }">{{ row.expectedQty }}</template>
          </el-table-column>
          <el-table-column label="实收确认" width="120" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.actualQty" :min="0" size="small" controls-position="right" class="qty-input" />
            </template>
          </el-table-column>
          <el-table-column label="差异" width="64" align="right">
            <template #default="{ row }">
              <span :class="{ 'diff-warn': row.actualQty !== row.expectedQty }">
                {{ row.actualQty - row.expectedQty }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="QC" width="96" align="center">
            <template #default="{ row }">
              <el-select v-model="row.qcStatus" size="small">
                <el-option label="通过" value="pass" />
                <el-option label="异常" value="fail" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="QC 备注" min-width="120">
            <template #default="{ row }">
              <el-input v-model="row.qcRemark" size="small" placeholder="说明" clearable />
            </template>
          </el-table-column>
        </el-table>
        <div v-if="canResolve" class="qc-footer">
          <el-checkbox v-model="qcAcceptDiff">确认接受数量差异（需主管权限）</el-checkbox>
        </div>
        <div class="panel-actions">
          <el-button v-if="canQc" type="primary" @click="submitQc">提交清点</el-button>
        </div>
      </template>
      <el-empty v-else description="请选择作业入库单" />
    </div>

    <!-- 测量体积 -->
    <div v-show="workStep === 'measure'" v-loading="loadingOrder" class="panel">
      <template v-if="activeOrder">
        <el-alert v-if="activeOrder.status === 'exception'" type="error" :closable="false" show-icon style="margin-bottom:12px">
          该单清点异常，需主管放行后才能测量。
          <el-button v-if="canResolve" link type="primary" @click="resolveAndPutaway">异常放行</el-button>
        </el-alert>

        <el-descriptions :column="3" border size="small" class="order-summary">
          <el-descriptions-item label="入库单"><span class="mono">{{ activeOrder.inboundNo }}</span></el-descriptions-item>
          <el-descriptions-item label="目的仓"><span class="mono">{{ activeOrder.warehouseCode || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="测量进度">
            {{ measureSummary.measured }} / {{ measureSummary.total }} SKU
          </el-descriptions-item>
        </el-descriptions>

        <template v-if="activeOrder.status === 'pending_putaway' && putawayDraftLines.length">
          <div class="putaway-section-head">
            <span>待测量 SKU（{{ measureSummary.total }} 个 · 待测 {{ measureSummary.pending }}）</span>
            <span class="hint-inline">测量结果将回写 SKU 查询</span>
          </div>

          <div class="scan-block">
            <div class="scan-block-title">扫码选中 SKU</div>
            <el-form label-width="48px" @submit.prevent="submitMeasureSingle">
              <el-form-item label="SKU">
                <el-select
                  v-model="measureSelectedItemId"
                  filterable
                  placeholder="选择 SKU"
                  style="width:260px"
                  size="small"
                >
                  <el-option
                    v-for="line in putawayDraftLines"
                    :key="line.id"
                    :label="`${line.sku}${hasDimensions(line) ? ' ✓' : ''}`"
                    :value="line.id"
                  />
                </el-select>
                <el-input
                  ref="measureScanRef"
                  v-model="measureSkuScan"
                  placeholder="扫描 SKU 快速选中"
                  style="width:200px;margin-left:8px"
                  size="small"
                  clearable
                  @keyup.enter="onMeasureSkuScan"
                />
              </el-form-item>
              <el-form-item>
                <el-button v-if="canPutaway" type="primary" size="small" :loading="measureSubmitting" @click="submitMeasureSingle">
                  保存当前 SKU 测量
                </el-button>
              </el-form-item>
            </el-form>
          </div>

          <div class="sku-cards">
            <div
              v-for="(line, idx) in putawayDraftLines"
              :key="line.id"
              class="sku-card"
              :class="{ 'sku-card--active': line.id === measureSelectedItemId }"
              @click="measureSelectedItemId = line.id"
            >
              <div class="sku-card-head">
                <div class="sku-card-title">
                  <span class="sku-index">{{ idx + 1 }}</span>
                  <span class="mono sku-code">{{ line.sku }}</span>
                  <span v-if="line.productName" class="sku-name">{{ line.productName }}</span>
                </div>
                <div class="sku-qty-tags">
                  <el-tag size="small" type="info">待上架 {{ line.remaining }}</el-tag>
                  <el-tag v-if="hasDimensions(line)" size="small" type="success">已测量</el-tag>
                  <el-tag v-else size="small" type="warning">待测量</el-tag>
                </div>
              </div>
              <div class="sku-card-body sku-card-body--measure">
                <div class="field-group">
                  <div class="field-group-label">实测尺寸 (cm)</div>
                  <div class="dim-row">
                    <div class="dim-field">
                      <label>长</label>
                      <el-input-number v-model="line.lengthCm" :min="0.1" :precision="1" :controls="false" size="small" />
                    </div>
                    <div class="dim-field">
                      <label>宽</label>
                      <el-input-number v-model="line.widthCm" :min="0.1" :precision="1" :controls="false" size="small" />
                    </div>
                    <div class="dim-field">
                      <label>高</label>
                      <el-input-number v-model="line.heightCm" :min="0.1" :precision="1" :controls="false" size="small" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="panel-actions putaway-footer">
            <span class="footer-hint">全部测量完成后进入「扫码上架」</span>
            <div class="footer-actions">
              <el-button v-if="canPutaway" :loading="measureSubmitting" @click="submitMeasureAll">保存全部测量</el-button>
              <el-button
                v-if="measureSummary.pending === 0"
                type="primary"
                @click="goPutawayStep"
              >进入扫码上架</el-button>
            </div>
          </div>
        </template>
        <el-empty v-else-if="activeOrder.status === 'completed'" description="该入库单已上架完成" />
        <el-empty v-else description="暂无待测量明细，请先完成清点" />
      </template>
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
            还有 {{ measureSummary.pending }} 个 SKU 未完成体积测量。
            <el-button link type="primary" @click="goMeasureStep">去测量</el-button>
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
        <el-empty v-else-if="activeOrder.status === 'pending_putaway' && putawayDraftLines.length && !putawayReadyLines.length" description="请先完成体积测量">
          <el-button type="primary" @click="goMeasureStep">去测量体积</el-button>
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
.hint { font-size: 12px; color: var(--el-text-color-secondary); margin: 4px 0 0; }
.hint-inline { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.result-box { margin-top: 8px; padding: 12px; border-radius: 8px; font-size: 13px; max-width: 560px; }
.result-box.ok { background: #f0f9eb; border: 1px solid #c2e7b0; }
.result-box.err { background: #fef0f0; border: 1px solid #fbc4c4; }
.order-summary { margin-bottom: 12px; }
.panel-actions { margin-top: 12px; }
.qc-footer { margin-top: 12px; font-size: 13px; }
.qty-input { width: 100%; max-width: 108px; }
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
