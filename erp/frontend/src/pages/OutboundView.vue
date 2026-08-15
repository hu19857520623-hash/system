<script setup lang="ts">
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  outboundApi,
  customerApi,
  usersApi,
} from '@/api/client.js'
import { withAction } from '@/composables/useListLoader.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import OutboundLabelPanel from '@/components/outbound/OutboundLabelPanel.vue'
import {
  buildOutboundLabelSummary,
  outboundLabelActionKey,
  type OutboundLabelAction,
  type OutboundLabelLine,
} from '@/features/outbound/labels'
import { warehouseFilterOptions } from '@/utils/omsWarehouse.ts'

const app = useAppStore()
const route = useRoute()

type StatusFilter =
  | 'all'
  | 'pending_relabel'
  | 'pending_pick'
  | 'picking'
  | 'picked'
  | 'reviewing'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'exception'
  | 'problem'

const filterStatus = ref<StatusFilter>('pending_pick')
const searchQ = ref('')
const filterCustomer = ref<number | ''>('')
const filterDest = ref('all')
const filterSku = ref('')
const filterLogisticsProduct = ref('all')
const filterPicker = ref<number | ''>('')
const filterNeedsRelabel = ref('all')
const filterIsProblem = ref('all')
const filterPlatform = ref('all')
const filterAppointment = ref('all')
const dateRange = ref<[string, string] | null>(null)
const appointmentDateRange = ref<[string, string] | null>(null)
const selectedRows = ref<any[]>([])

const page = ref(1)
const pageSize = ref(50)
const listTotal = ref(0)
const loading = ref(false)
const orders = ref<any[]>([])

const statusCounts = ref<Record<string, number>>({
  all: 0,
  pending_relabel: 0,
  pending_pick: 0,
  picking: 0,
  picked: 0,
  reviewing: 0,
  packed: 0,
  shipped: 0,
  delivered: 0,
  cancelled: 0,
  exception: 0,
  problem: 0,
})

const pickVisible = ref(false)
const shipVisible = ref(false)
const assignVisible = ref(false)
const problemVisible = ref(false)
const exceptionVisible = ref(false)
const packVisible = ref(false)
const appointmentVisible = ref(false)
const relabelVisible = ref(false)
const podUploadVisible = ref(false)
const labelVisible = ref(false)
const pickOrder = ref<any>(null)
const packOrder = ref<any>(null)
const appointmentOrder = ref<any>(null)
const relabelOrder = ref<any>(null)
const labelOrder = ref<any>(null)
const deliverOrder = ref<any>(null)
const shipOrder = ref<any>(null)
const problemOrder = ref<any>(null)
const exceptionOrder = ref<any>(null)
const shipTrackingNo = ref('')
const shipCarrier = ref('')
const shipLogisticsProduct = ref('')
const packIsPalletized = ref(false)
const packPalletInfo = ref('')
const packReviewSource = ref<'pda' | 'pick_list'>('pick_list')
const packCartons = ref<{ lengthCm: string; widthCm: string; heightCm: string; grossWeightKg: string }[]>([
  { lengthCm: '', widthCm: '', heightCm: '', grossWeightKg: '' },
])
const pickSource = ref<'pda' | 'pick_list'>('pda')
const appointmentStatus = ref('')
const appointmentDate = ref('')
const deliverPodFile = ref<File | null>(null)
const podFileInputRef = ref<HTMLInputElement | null>(null)
const assignPickerId = ref<number | null>(null)
const problemRemark = ref('')
const exceptionRemark = ref('')
const pickLines = ref<any[]>([])
const pickLoading = ref(false)
const packDetailLoading = ref(false)
const labelDetailLoading = ref(false)
const labelActionLoading = reactive<Record<string, boolean>>({})
const relabelLines = ref<{ id: number; sku: string; productName: string; scannedBarcode: string; newBarcode: string }[]>([])

const customers = ref<{ id: number; code: string; name: string }[]>([])
const pickerUsers = ref<{ id: number; name: string }[]>([])
const destWarehouseOptions = warehouseFilterOptions()

const LOGISTICS_PRODUCTS = ['CPT', 'JHB', 'CPT-JHB', 'FBA-TRANSIT', 'LOCAL']
const CARRIERS = ['本地车队', 'DHL', 'FedEx', '自提', 'Other']
const PLATFORMS = ['Takealot', 'Amazon', 'Shein', 'Other']
const APPOINTMENT_STATUSES = [
  { value: 'none', label: '未预约' },
  { value: 'pending', label: '待预约' },
  { value: 'scheduled', label: '已预约' },
  { value: 'completed', label: '预约完成' },
]

const STATUS_MAP: Record<string, { label: string; tag: string }> = {
  pending_pick: { label: '待拣货', tag: 'warning' },
  picking: { label: '拣货中', tag: 'warning' },
  picked: { label: '已拣货', tag: '' },
  reviewing: { label: '复核中', tag: '' },
  pending_relabel: { label: '待换标', tag: 'warning' },
  packed: { label: '待发运', tag: 'success' },
  shipped: { label: '已发运', tag: 'info' },
  delivered: { label: '已送达', tag: 'success' },
  exception: { label: '异常', tag: 'danger' },
  cancelled: { label: '已取消', tag: 'info' },
}

const filterTabs = computed(() => [
  { value: 'pending_pick' as const, label: '待拣货', count: statusCounts.value.pending_pick },
  { value: 'picking' as const, label: '拣货中', count: statusCounts.value.picking },
  { value: 'picked' as const, label: '已拣货', count: statusCounts.value.picked },
  { value: 'reviewing' as const, label: '复核中', count: statusCounts.value.reviewing },
  { value: 'pending_relabel' as const, label: '待换标', count: statusCounts.value.pending_relabel },
  { value: 'packed' as const, label: '待发运', count: statusCounts.value.packed },
  { value: 'shipped' as const, label: '已发货', count: statusCounts.value.shipped },
  { value: 'delivered' as const, label: '已送达', count: statusCounts.value.delivered },
  { value: 'exception' as const, label: '异常', count: statusCounts.value.exception },
  { value: 'cancelled' as const, label: '已作废', count: statusCounts.value.cancelled },
  { value: 'problem' as const, label: '问题件', count: statusCounts.value.problem },
  { value: 'all' as const, label: '全部', count: statusCounts.value.all },
])

function buildQueryParams(skipStatus = false) {
  const p: Record<string, unknown> = { page: page.value, pageSize: pageSize.value }
  if (!skipStatus && filterStatus.value !== 'all') {
    if (filterStatus.value === 'problem') {
      p.isProblem = 'true'
    } else if (filterStatus.value === 'exception') {
      p.status = 'exception'
    } else {
      p.status = filterStatus.value
    }
  }
  const kw = searchQ.value.trim()
  if (kw) p.keyword = kw
  if (filterCustomer.value) p.customerId = String(filterCustomer.value)
  if (filterDest.value !== 'all') p.destWarehouse = filterDest.value
  const sku = filterSku.value.trim()
  if (sku) p.sku = sku
  if (dateRange.value?.[0]) p.createdFrom = dateRange.value[0]
  if (dateRange.value?.[1]) p.createdTo = dateRange.value[1]
  if (filterLogisticsProduct.value !== 'all') p.logisticsProduct = filterLogisticsProduct.value
  if (filterPicker.value) p.pickerId = String(filterPicker.value)
  if (filterNeedsRelabel.value !== 'all') p.needsRelabel = filterNeedsRelabel.value
  if (filterIsProblem.value !== 'all') p.isProblem = filterIsProblem.value
  if (filterPlatform.value !== 'all') p.platform = filterPlatform.value
  if (filterAppointment.value !== 'all') p.appointmentStatus = filterAppointment.value
  if (appointmentDateRange.value?.[0]) p.appointmentFrom = appointmentDateRange.value[0]
  if (appointmentDateRange.value?.[1]) p.appointmentTo = appointmentDateRange.value[1]
  return p
}

async function refreshCounts() {
  try {
    statusCounts.value = await outboundApi.statusCounts(buildQueryParams(true))
  } catch {
    // 计数失败不影响列表
  }
}

async function load() {
  loading.value = true
  try {
    const res = await outboundApi.list(buildQueryParams())
    orders.value = res.items || []
    listTotal.value = res.total ?? orders.value.length
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function reloadAll() {
  await Promise.all([load(), refreshCounts()])
}

function search() {
  page.value = 1
  reloadAll()
}

function rowIndex(index: number) {
  return (page.value - 1) * pageSize.value + index + 1
}

async function copyText(text: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

function cargoTypeLabel(row: any) {
  return row.cargoTypeLabel || row.cargoType || '—'
}

function customerLabel(row: any) {
  if (row.customerCode && row.customerName && row.customerName !== '—') {
    return `${row.customerCode} · ${row.customerName}`
  }
  return row.customerName || row.customerCode || '—'
}

function handleRowCommand(command: string, row: any) {
  if (command.startsWith('downloadAtt:')) {
    const attId = Number(command.slice('downloadAtt:'.length))
    downloadAttachmentById(row, attId)
    return
  }
  switch (command) {
    case 'labels':
      openLabelManager(row)
      break
    case 'relabel':
      openRelabel(row)
      break
    case 'downloadPick':
      downloadPickList(row)
      break
    case 'pick':
      openPick(row)
      break
    case 'pack':
      openPack(row)
      break
    case 'ship':
      openShip(row)
      break
    case 'deliver':
      openDeliver(row)
      break
    case 'uploadPod':
      openPodUpload(row)
      break
    case 'appointment':
      openAppointment(row)
      break
    case 'problem':
      openProblem(row)
      break
    case 'exception':
      openException(row)
      break
    case 'clearProblem':
      clearProblemMark(row)
      break
    case 'clearException':
      clearException(row)
      break
    case 'cancel':
      doCancel(row)
      break
    case 'downloadCpt':
      downloadAttachment(row)
      break
    default:
      break
  }
}

function openAppointmentForSelected() {
  const row = selectedRows.value[0]
  if (!row) {
    ElMessage.warning('请先勾选一条出库单')
    return
  }
  openAppointment(row)
}

function resetFilters() {
  searchQ.value = ''
  filterCustomer.value = ''
  filterDest.value = 'all'
  filterSku.value = ''
  filterLogisticsProduct.value = 'all'
  filterPicker.value = ''
  filterNeedsRelabel.value = 'all'
  filterIsProblem.value = 'all'
  filterPlatform.value = 'all'
  filterAppointment.value = 'all'
  dateRange.value = null
  appointmentDateRange.value = null
  page.value = 1
  reloadAll()
}

onMounted(async () => {
  const q = String(route.query.q || '').trim()
  if (q) searchQ.value = q
  try {
    const cRes = await customerApi.list({ pageSize: 500 })
    customers.value = (cRes.items || []).map((c: any) => ({
      id: c.id,
      code: c.customerCode || '',
      name: c.customerName || c.customerCode || '',
    }))
  } catch {
    customers.value = []
  }
  try {
    const uRes = await usersApi.list({ pageSize: 100, status: 1 })
    pickerUsers.value = (uRes.items || [])
      .filter((u: any) => u.status === 1)
      .map((u: any) => ({ id: u.id, name: u.realName || u.username }))
  } catch {
    pickerUsers.value = []
  }
  await reloadAll()
})

watch(filterStatus, () => {
  page.value = 1
  reloadAll()
})

watch([page, pageSize], () => {
  load()
})

const canCreate = computed(() => app.hasPerm('outbound.create'))
const canRelabel = computed(() => app.hasPerm('outbound.relabel'))
const canPick = computed(() => app.hasPerm('outbound.pick'))
const canPack = computed(() => app.hasPerm('outbound.pack'))
const canShip = computed(() => app.hasPerm('outbound.ship'))
const canExport = computed(() => app.hasPerm('outbound.view'))
const relabelLabelSummary = computed(() => buildOutboundLabelSummary(relabelOrder.value))
const relabelUsesPlatformUnitLabels = computed(() =>
  relabelLabelSummary.value.isTakealot && relabelLabelSummary.value.hasLabelMetadata,
)

const assignableSelected = computed(() =>
  selectedRows.value.filter((r) => r.status === 'pending_pick'),
)

const printablePickOrders = computed(() => {
  if (selectedRows.value.length) {
    return selectedRows.value.filter((r) => ['pending_pick', 'picking'].includes(r.status))
  }
  return orders.value.filter((r) => ['pending_pick', 'picking'].includes(r.status))
})

function handleSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

async function downloadAttachment(row: any) {
  try {
    const { blob, fileName } = await outboundApi.downloadAttachment(row.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || row.attachmentName || 'cpt-attachment'
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: any) {
    ElMessage.error(err.message || '下载失败')
  }
}

async function downloadAttachmentById(row: any, attachmentId: number) {
  try {
    const { blob, fileName } = await outboundApi.downloadAttachmentById(row.id, attachmentId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'attachment'
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: any) {
    ElMessage.error(err.message || '下载失败')
  }
}

async function openLabelManager(row: any) {
  labelOrder.value = row
  labelVisible.value = true
  labelDetailLoading.value = true
  try {
    labelOrder.value = await outboundApi.detail(row.id)
  } catch (err: any) {
    ElMessage.error(err?.message || '加载平台商品标签失败')
  } finally {
    labelDetailLoading.value = false
  }
}

async function printOutboundLabels(
  order: any,
  action: OutboundLabelAction,
  sku?: string,
  unitIndex?: number,
) {
  if (!order?.id) {
    ElMessage.error('出库单信息不完整，无法打印')
    return
  }

  const summary = buildOutboundLabelSummary(order)
  const line = sku
    ? summary.lines.find(item => item.internalSku.toLowerCase() === sku.toLowerCase())
    : undefined

  if (!summary.isTakealot) {
    ElMessage.info('无平台商品标签')
    return
  }
  if (action === 'order' && !summary.allPrintable) {
    ElMessage.warning('全部 SKU 的标签张数与应贴数量一致后才能打印整单')
    return
  }
  if (action !== 'order' && !line?.printable) {
    ElMessage.warning(`${sku || '此 SKU'} 的标签尚未准备完整`)
    return
  }
  if (action === 'unit' && (unitIndex === undefined || !line?.unitIndices.includes(unitIndex))) {
    ElMessage.warning('该单件标签索引不存在')
    return
  }

  const actionKey = outboundLabelActionKey(order.id, action, sku, unitIndex)
  if (labelActionLoading[actionKey]) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    ElMessage.error('无法打开打印窗口，请允许浏览器弹窗后重试')
    return
  }

  printWindow.document.title = '正在加载商品标签'
  printWindow.document.body.textContent = '正在加载已裁切的商品标签 PDF…'
  labelActionLoading[actionKey] = true

  try {
    const result = action === 'order'
      ? await outboundApi.downloadSkuLabels(order.id)
      : action === 'sku'
        ? await outboundApi.downloadSkuLabelsBySku(order.id, sku!)
        : await outboundApi.downloadSkuLabelUnit(order.id, sku!, unitIndex!)

    if (!result.blob?.size) throw new Error('标签 PDF 内容为空')

    const blobUrl = URL.createObjectURL(result.blob)
    printWindow.addEventListener('load', () => {
      try {
        printWindow.focus()
        printWindow.print()
      } catch {
        // 浏览器 PDF 查看器仍会保留手动打印入口
      }
    }, { once: true })
    printWindow.location.replace(blobUrl)
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000)
    ElMessage.success('标签 PDF 已打开；若未自动弹出打印框，请使用浏览器打印')
  } catch (err: any) {
    if (!printWindow.closed) printWindow.close()
    ElMessage.error(err?.message || '打开标签 PDF 失败')
  } finally {
    delete labelActionLoading[actionKey]
  }
}

function printOrderLabels(order: any) {
  return printOutboundLabels(order, 'order')
}

function printSkuLabels(order: any, line: OutboundLabelLine) {
  return printOutboundLabels(order, 'sku', line.internalSku)
}

function printUnitLabel(order: any, line: OutboundLabelLine, unitIndex: number) {
  return printOutboundLabels(order, 'unit', line.internalSku, unitIndex)
}

async function openRelabel(row: any) {
  if (!canRelabel.value) return
  try {
    const detail = await outboundApi.detail(row.id)
    relabelOrder.value = detail
    relabelLines.value = (detail.items || []).map((item: any) => ({
      id: item.id,
      sku: item.sku,
      productName: item.productName || '',
      scannedBarcode: item.oldBarcode || '',
      newBarcode: item.newBarcode || '',
    }))
    relabelVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.message || '加载换标明细失败')
  }
}

async function submitRelabel(allowSkipScan = false) {
  if (!relabelOrder.value || !canRelabel.value) return
  const usesPlatformUnitLabels = relabelUsesPlatformUnitLabels.value
  if (usesPlatformUnitLabels && !relabelLabelSummary.value.allPrintable) {
    ElMessage.warning('全部 SKU 的标签张数与应贴数量一致后才能确认贴标')
    return
  }
  const skipScan = allowSkipScan || usesPlatformUnitLabels
  if (!skipScan) {
    for (const line of relabelLines.value) {
      if (!line.scannedBarcode?.trim()) {
        ElMessage.warning(`请扫描 ${line.sku} 的旧条码`)
        return
      }
    }
  }
  await withAction(async () => {
    await outboundApi.confirmRelabel(relabelOrder.value.id, {
      allowSkipScan: skipScan,
      items: skipScan
        ? undefined
        : relabelLines.value.map((l) => ({
            id: l.id,
            scannedBarcode: l.scannedBarcode.trim(),
            newBarcode: l.newBarcode.trim() || undefined,
          })),
    })
    relabelVisible.value = false
    filterStatus.value = 'packed'
    await reloadAll()
  }, `${relabelOrder.value.outboundNo} 换标已确认，进入待发运`)
}

async function openPick(row: any) {
  pickOrder.value = row
  pickSource.value = 'pda'
  pickLines.value = []
  pickVisible.value = true
  pickLoading.value = true
  try {
    const data = await outboundApi.pickSuggestions(row.id)
    pickLines.value = (data.items || []).map((item: any) => ({
      id: item.id,
      sku: item.sku,
      qty: item.qty,
      pickedQty: item.pickedQty ?? item.qty,
      locationCode: item.locationCode || '',
    }))
    if (pickLines.value.some((l) => !l.locationCode)) {
      ElMessage.warning('部分 SKU 暂无可用库位，请确认已上架')
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '加载拣货库位失败')
    pickVisible.value = false
  } finally {
    pickLoading.value = false
  }
}

async function downloadPickList(row: any) {
  if (!canPick.value && !canExport.value) return
  try {
    await outboundApi.downloadPickList(row.id)
  } catch (err: any) {
    ElMessage.error(err.message || '下载拣货清单失败')
  }
}

async function submitPick() {
  if (!pickOrder.value || !canPick.value) return
  if (pickLines.value.some((l) => !l.locationCode)) {
    ElMessage.warning('存在未分配库位的 SKU，请先完成上架')
    return
  }
  await withAction(async () => {
    await outboundApi.pick(pickOrder.value.id, {
      pickSource: pickSource.value,
      items: pickLines.value.map((l) => ({
        id: l.id,
        pickedQty: l.pickedQty,
      })),
    })
    pickVisible.value = false
    filterStatus.value = 'picked'
    await reloadAll()
  }, `${pickOrder.value.outboundNo} 已完成拣货`)
}

async function openPack(row: any) {
  if (row.status === 'picked' && canPack.value) {
    try {
      await outboundApi.startReview(row.id)
      row.status = 'reviewing'
    } catch (err: any) {
      ElMessage.error(err?.message || '无法开始复核')
      return
    }
  }
  packOrder.value = row
  packIsPalletized.value = !!row.isPalletized
  packPalletInfo.value = row.palletInfo || ''
  packReviewSource.value = row.reviewSource === 'pda' ? 'pda' : 'pick_list'
  packCartons.value = [{ lengthCm: '', widthCm: '', heightCm: '', grossWeightKg: '' }]
  packVisible.value = true
  packDetailLoading.value = true
  try {
    packOrder.value = await outboundApi.detail(row.id)
  } catch (err: any) {
    ElMessage.error(err?.message || '加载复核明细失败')
  } finally {
    packDetailLoading.value = false
  }
}

function addPackCarton() {
  packCartons.value.push({ lengthCm: '', widthCm: '', heightCm: '', grossWeightKg: '' })
}

function removePackCarton(index: number) {
  if (packCartons.value.length <= 1) return
  packCartons.value.splice(index, 1)
}

async function submitPack() {
  if (!packOrder.value || !canPack.value) return
  const needsMeasure = !!packOrder.value.omsPreDeduct
  const cartons = packCartons.value
    .map(c => ({
      lengthCm: Number(c.lengthCm),
      widthCm: Number(c.widthCm),
      heightCm: Number(c.heightCm),
      grossWeightKg: Number(c.grossWeightKg) || 0,
    }))
    .filter(c => c.lengthCm > 0 && c.widthCm > 0 && c.heightCm > 0)

  if (needsMeasure && cartons.length === 0) {
    ElMessage.warning('请填写外箱实测尺寸（长/宽/高 cm）')
    return
  }

  const needsRelabel = !!packOrder.value.needsRelabel
  await withAction(async () => {
    await outboundApi.pack(packOrder.value.id, {
      isPalletized: packIsPalletized.value,
      palletInfo: packPalletInfo.value.trim() || undefined,
      reviewSource: packReviewSource.value,
      cartons: cartons.length ? cartons : undefined,
    })
    packVisible.value = false
    filterStatus.value = needsRelabel ? 'pending_relabel' : 'packed'
    await reloadAll()
  }, needsRelabel
    ? `${packOrder.value.outboundNo} 复核完成，进入换标`
    : `${packOrder.value.outboundNo} 复核打包完成`)
}

function openAppointment(row: any) {
  appointmentOrder.value = row
  appointmentStatus.value = row.appointmentStatus || (row.appointmentDate ? 'scheduled' : 'pending')
  appointmentDate.value = row.appointmentDate || ''
  appointmentVisible.value = true
}

async function submitAppointment() {
  if (!appointmentOrder.value || !canCreate.value) return
  await withAction(async () => {
    await outboundApi.setAppointment(appointmentOrder.value.id, {
      appointmentStatus: appointmentStatus.value,
      appointmentDate: appointmentDate.value || null,
    })
    appointmentVisible.value = false
    await reloadAll()
  }, `${appointmentOrder.value.outboundNo} 预约已更新`)
}

function rowHasPod(row: any) {
  return !!(row.podCode || (row.attachments || []).some((a: any) => a.fileType === 'pod'))
}

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

async function openDeliver(row: any) {
  if (!canShip.value) return
  try {
    await ElMessageBox.confirm(
      `确认出库单 ${row.outboundNo} 已送达平台仓？\n送达后请上传 POD 签收单文件（无需扫描 POD 码）。`,
      '确认送达',
      { confirmButtonText: '确认送达', cancelButtonText: '取消', type: 'info' },
    )
  } catch {
    return
  }
  await withAction(async () => {
    await outboundApi.deliver(row.id, {})
    deliverOrder.value = row
    deliverPodFile.value = null
    podUploadVisible.value = true
    await reloadAll()
  }, `${row.outboundNo} 已确认送达`)
}

function openPodUpload(row: any) {
  if (!canCreate.value) return
  deliverOrder.value = row
  deliverPodFile.value = null
  podUploadVisible.value = true
}

function onPodFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  deliverPodFile.value = input.files?.[0] ?? null
}

async function submitPodUpload() {
  if (!deliverOrder.value) {
    podUploadVisible.value = false
    return
  }
  if (!deliverPodFile.value) {
    ElMessage.warning('请选择 POD 签收单文件')
    return
  }
  const file = deliverPodFile.value
  await withAction(async () => {
    await outboundApi.uploadAttachment(deliverOrder.value.id, {
      fileName: file.name,
      contentBase64: await readFileAsBase64(file),
      fileType: 'pod',
    })
    podUploadVisible.value = false
    deliverPodFile.value = null
    if (podFileInputRef.value) podFileInputRef.value.value = ''
    await reloadAll()
  }, `${deliverOrder.value.outboundNo} POD 已上传`)
}

function skipPodUpload() {
  podUploadVisible.value = false
  deliverPodFile.value = null
  if (podFileInputRef.value) podFileInputRef.value.value = ''
}

function openShip(row: any) {
  shipOrder.value = row
  shipTrackingNo.value = row.trackingNo || ''
  shipCarrier.value = row.carrier || ''
  shipLogisticsProduct.value = row.logisticsProduct || ''
  shipVisible.value = true
}

async function submitShip() {
  if (!shipOrder.value || !canShip.value) return
  await withAction(async () => {
    await outboundApi.ship(shipOrder.value.id, {
      trackingNo: shipTrackingNo.value.trim() || undefined,
      carrier: shipCarrier.value.trim() || undefined,
      logisticsProduct: shipLogisticsProduct.value.trim() || undefined,
    })
    shipVisible.value = false
    await reloadAll()
  }, `${shipOrder.value.outboundNo} 已发运，库存已扣减并生成计费`)
}

function openAssignPicker() {
  if (!canPick.value) return
  const rows = assignableSelected.value
  if (!rows.length) {
    ElMessage.warning('请勾选待拣货的出库单')
    return
  }
  assignPickerId.value = pickerUsers.value[0]?.id ?? null
  assignVisible.value = true
}

async function submitAssignPicker() {
  if (!assignPickerId.value) {
    ElMessage.warning('请选择拣货员')
    return
  }
  await withAction(async () => {
    await outboundApi.assignPicker({
      ids: assignableSelected.value.map((r) => r.id),
      pickerId: assignPickerId.value!,
    })
    assignVisible.value = false
    selectedRows.value = []
    filterStatus.value = 'picking'
    await reloadAll()
  }, `已分配 ${assignableSelected.value.length} 单`)
}

function openProblem(row: any) {
  problemOrder.value = row
  problemRemark.value = row.problemRemark || ''
  problemVisible.value = true
}

function openException(row: any) {
  exceptionOrder.value = row
  exceptionRemark.value = row.problemRemark || ''
  exceptionVisible.value = true
}

async function submitProblem() {
  if (!problemOrder.value || !canCreate.value) return
  const outboundNo = problemOrder.value.outboundNo
  const ok = await withAction(async () => {
    await outboundApi.setProblem(problemOrder.value.id, {
      markType: 'problem',
      problemRemark: problemRemark.value.trim() || undefined,
    })
    problemVisible.value = false
    filterStatus.value = 'problem'
    await reloadAll()
  }, `${outboundNo} 已标记为问题件（流程可继续）`)
  if (ok) page.value = 1
}

async function submitException() {
  if (!exceptionOrder.value || !canCreate.value) return
  const outboundNo = exceptionOrder.value.outboundNo
  const ok = await withAction(async () => {
    await outboundApi.setProblem(exceptionOrder.value.id, {
      markType: 'exception',
      problemRemark: exceptionRemark.value.trim() || undefined,
    })
    exceptionVisible.value = false
    filterStatus.value = 'exception'
    await reloadAll()
  }, `${outboundNo} 已标记异常（流程已暂停）`)
  if (ok) page.value = 1
}

async function clearProblemMark(row: any) {
  if (!canCreate.value) return
  await withAction(async () => {
    await outboundApi.setProblem(row.id, { markType: 'clear_problem' })
    await reloadAll()
  }, `${row.outboundNo} 已解除问题件标记`)
}

async function clearException(row: any) {
  if (!canCreate.value) return
  const restoreLabel = STATUS_MAP[row.exceptionFromStatus]?.label || row.exceptionFromStatus || '待拣货'
  await withAction(async () => {
    await outboundApi.setProblem(row.id, { markType: 'clear_exception' })
    await reloadAll()
  }, `${row.outboundNo} 已解除异常，恢复为「${restoreLabel}」`)
}

async function doExport() {
  if (!canExport.value) return
  try {
    const { blob, fileName } = await outboundApi.exportCsv(buildQueryParams())
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'outbound-export.csv'
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (err: any) {
    ElMessage.error(err.message || '导出失败')
  }
}

function printPickList() {
  const rows = printablePickOrders.value
  if (!rows.length) {
    ElMessage.warning('没有可打印的待拣货单')
    return
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>拣货单</title>
<style>
body{font-family:sans-serif;padding:16px;font-size:12px}
h2{margin:0 0 12px}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f5f5f5}
.meta{color:#666;margin-bottom:12px}
</style></head><body>
<h2>出库拣货单</h2>
<div class="meta">打印时间：${new Date().toLocaleString('zh-CN')} · 共 ${rows.length} 单</div>
<table><thead><tr>
<th>出库单</th><th>客户</th><th>仓库</th><th>SKU</th><th>件数</th><th>拣货员</th><th>备注</th>
</tr></thead><tbody>
${rows.map((r) => `<tr>
<td>${r.outboundNo}</td><td>${r.customerName || '—'}</td><td>${r.warehouseCode}</td>
<td>${r.skuSummary}</td><td>${r.totalQty}</td><td>${r.pickerName || '—'}</td><td>${r.remarkSummary || '—'}</td>
</tr>`).join('')}
</tbody></table>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`
  const win = window.open('', '_blank')
  if (!win) {
    ElMessage.error('无法打开打印窗口，请允许弹窗')
    return
  }
  win.document.write(html)
  win.document.close()
}

async function doCancel(row: any) {
  if (!canCreate.value) return
  await withAction(async () => {
    await outboundApi.cancel(row.id)
    await reloadAll()
  }, `${row.outboundNo} 已取消，锁定库存已释放`)
}

function statusLabel(status: string) {
  return STATUS_MAP[status]?.label || status
}

function statusTag(status: string) {
  return STATUS_MAP[status]?.tag || 'info'
}
</script>

<template>
  <div class="outbound-page">
    <el-card v-loading="loading" class="outbound-card">
      <template #header>
        <div class="page-header">
          <div>
            <span class="page-title">出库单管理</span>
            <p class="page-desc">出库单由客户在 OMS 预约创建，ERP 负责拣货、打包与发运。</p>
          </div>
          <el-button size="small" text @click="reloadAll">刷新</el-button>
        </div>
      </template>

      <div class="filter-card">
        <div class="filter-grid">
          <div class="filter-item filter-item--span2">
            <label>单号</label>
            <el-input
              v-model="searchQ"
              placeholder="出库单号 / PO / 跟踪号"
              clearable
              size="small"
              @keyup.enter="search"
            />
          </div>
          <div class="filter-item">
            <label>客户</label>
            <el-select v-model="filterCustomer" clearable placeholder="全部客户" size="small" style="width:100%" filterable>
              <el-option
                v-for="c in customers"
                :key="c.id"
                :label="c.code ? `${c.code} · ${c.name}` : c.name"
                :value="c.id"
              />
            </el-select>
          </div>
          <div class="filter-item">
            <label>创建时间</label>
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始"
              end-placeholder="结束"
              value-format="YYYY-MM-DD"
              size="small"
              style="width:100%"
            />
          </div>

          <div class="filter-item">
            <label>SKU</label>
            <el-input v-model="filterSku" placeholder="SKU / 客户唛头" clearable size="small" />
          </div>
          <div class="filter-item">
            <label>目的地</label>
            <el-select v-model="filterDest" size="small" style="width:100%">
              <el-option
                v-for="opt in destWarehouseOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
          <div class="filter-item">
            <label>物流产品</label>
            <el-select v-model="filterLogisticsProduct" size="small" style="width:100%">
              <el-option label="全部" value="all" />
              <el-option v-for="p in LOGISTICS_PRODUCTS" :key="p" :label="p" :value="p" />
            </el-select>
          </div>

          <div class="filter-item">
            <label>拣货员</label>
            <el-select v-model="filterPicker" clearable placeholder="全部" size="small" style="width:100%">
              <el-option v-for="u in pickerUsers" :key="u.id" :label="u.name" :value="u.id" />
            </el-select>
          </div>
          <div class="filter-item">
            <label>换标</label>
            <el-select v-model="filterNeedsRelabel" size="small" style="width:100%">
              <el-option label="全部" value="all" />
              <el-option label="需换标" value="true" />
              <el-option label="不换标" value="false" />
            </el-select>
          </div>

          <div class="filter-item">
            <label>平台</label>
            <el-select v-model="filterPlatform" size="small" style="width:100%">
              <el-option label="全部平台" value="all" />
              <el-option v-for="p in PLATFORMS" :key="p" :label="p" :value="p" />
            </el-select>
          </div>
          <div class="filter-item">
            <label>平台预约</label>
            <el-select v-model="filterAppointment" size="small" style="width:100%">
              <el-option label="全部" value="all" />
              <el-option v-for="a in APPOINTMENT_STATUSES" :key="a.value" :label="a.label" :value="a.value" />
            </el-select>
          </div>
          <div class="filter-item">
            <label>预约日期</label>
            <el-date-picker
              v-model="appointmentDateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始"
              end-placeholder="结束"
              value-format="YYYY-MM-DD"
              size="small"
              style="width:100%"
            />
          </div>
          <div class="filter-item">
            <label>问题件</label>
            <el-select v-model="filterIsProblem" size="small" style="width:100%">
              <el-option label="全部" value="all" />
              <el-option label="问题件" value="true" />
              <el-option label="正常" value="false" />
            </el-select>
          </div>
        </div>
        <div class="filter-actions">
          <el-button type="primary" size="small" @click="search">查询</el-button>
          <el-button size="small" @click="resetFilters">重置</el-button>
        </div>
      </div>

      <div class="status-bar">
        <div class="status-tabs">
          <el-radio-group v-model="filterStatus" size="small">
            <el-radio-button v-for="tab in filterTabs" :key="tab.value" :value="tab.value">
              {{ tab.label }}<span class="tab-count">({{ tab.count }})</span>
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="status-bar-actions">
          <el-button v-if="canExport" size="small" text @click="doExport">导出</el-button>
        </div>
      </div>

      <div class="table-toolbar">
        <div class="toolbar-left">
          <el-button v-if="canCreate" size="small" @click="openAppointmentForSelected">预约派送</el-button>
          <el-button
            v-if="canPick"
            size="small"
            :disabled="!assignableSelected.length"
            @click="openAssignPicker"
          >
            分配拣货员
          </el-button>
          <el-button
            v-if="canPick"
            size="small"
            :disabled="!printablePickOrders.length"
            @click="printPickList"
          >
            打印拣货单
          </el-button>
        </div>
      </div>

      <el-table
        :data="orders"
        stripe
        border
        size="small"
        class="outbound-table"
        empty-text="暂无出库单"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="42" fixed="left" />
        <el-table-column label="NO." width="52" align="center" fixed="left">
          <template #default="{ $index }">{{ rowIndex($index) }}</template>
        </el-table-column>
        <el-table-column label="出库单号" min-width="160" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <span class="order-no-link mono">{{ row.outboundNo }}</span>
            <el-button link type="primary" size="small" class="copy-btn" @click="copyText(row.outboundNo)">
              复制
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="客户" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ customerLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="目的地" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.destination || '—' }}</template>
        </el-table-column>
        <el-table-column label="收件人" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.recipient ? `${row.recipient.name} · ${row.recipient.phone}` : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="物流产品" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.logisticsProduct || '—' }}</template>
        </el-table-column>
        <el-table-column label="箱货类型" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ cargoTypeLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status) as any" size="small">{{ statusLabel(row.status) }}</el-tag>
            <el-tag v-if="row.isProblem && row.status !== 'exception'" size="small" type="danger" class="problem-tag">
              问题
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="88" fixed="right" align="center">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="(cmd: string) => handleRowCommand(cmd, row)">
              <el-button link type="primary" size="small">操作</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="labels">
                    平台商品标签
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="row.status === 'pending_relabel' && canRelabel"
                    command="relabel"
                  >
                    扫码换标
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="['pending_pick', 'picking'].includes(row.status) && canPick"
                    command="downloadPick"
                  >
                    下载拣货清单
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="['pending_pick', 'picking'].includes(row.status) && canPick"
                    command="pick"
                  >
                    完成拣货
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="['picked', 'reviewing'].includes(row.status) && canPack"
                    command="pack"
                  >
                    复核打包
                  </el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'packed' && canShip" command="ship">
                    发运
                  </el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'shipped' && canShip" command="deliver">
                    确认送达
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="row.status === 'delivered' && canCreate && !rowHasPod(row)"
                    command="uploadPod"
                  >
                    上传POD签收单
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="canCreate && row.destType === 'fba' && row.status !== 'cancelled'"
                    command="appointment"
                  >
                    预约派送
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-for="att in (row.attachments?.length ? row.attachments : (row.attachmentName ? [{ id: 0, fileName: row.attachmentName, fileType: 'other' }] : []))"
                    :key="att.id || att.fileName"
                    :command="att.id ? `downloadAtt:${att.id}` : 'downloadCpt'"
                  >
                    下载{{ att.fileType === 'pod' ? 'POD签收单' : att.fileType === 'outerLabel' ? '外箱标' : att.fileType === 'skuLabel' ? 'SKU标签' : att.fileType === 'deliveryList' ? '发货清单' : att.fileType === 'appointment' ? '预约单' : '附件' }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="canCreate && !['cancelled', 'shipped', 'delivered'].includes(row.status)"
                    command="problem"
                    divided
                  >
                    标记问题件
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="canCreate && row.status !== 'exception' && !['cancelled', 'shipped', 'delivered'].includes(row.status)"
                    command="exception"
                  >
                    标记异常（暂停流程）
                  </el-dropdown-item>
                  <el-dropdown-item v-if="canCreate && row.isProblem" command="clearProblem">
                    解除问题件
                  </el-dropdown-item>
                  <el-dropdown-item v-if="canCreate && row.status === 'exception'" command="clearException">
                    解除异常
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="canCreate && !['shipped', 'delivered', 'cancelled'].includes(row.status)"
                    command="cancel"
                  >
                    取消出库单
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />
    </el-card>

    <!-- 平台商品标签 -->
    <el-dialog
      v-model="labelVisible"
      :title="`平台商品标签 · ${labelOrder?.outboundNo || ''}`"
      width="min(980px, 94vw)"
    >
      <OutboundLabelPanel
        :detail="labelOrder"
        :loading="labelDetailLoading"
        :action-loading="labelActionLoading"
        @print-order="printOrderLabels(labelOrder)"
        @print-sku="(line) => printSkuLabels(labelOrder, line)"
        @print-unit="(line, unitIndex) => printUnitLabel(labelOrder, line, unitIndex)"
      />
      <template #footer>
        <el-button @click="labelVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 换标 -->
    <el-dialog
      v-model="relabelVisible"
      :title="`${relabelUsesPlatformUnitLabels ? '平台标签换标' : '扫码换标'} · ${relabelOrder?.outboundNo || ''}`"
      width="min(980px, 94vw)"
    >
      <OutboundLabelPanel
        :detail="relabelOrder"
        :action-loading="labelActionLoading"
        @print-order="printOrderLabels(relabelOrder)"
        @print-sku="(line) => printSkuLabels(relabelOrder, line)"
        @print-unit="(line, unitIndex) => printUnitLabel(relabelOrder, line, unitIndex)"
      />
      <div v-if="!relabelUsesPlatformUnitLabels" class="legacy-relabel">
        <div class="pick-hint">请扫描旧条码确认换标；新条码/FNSKU 可选填。确认后进入待发运。</div>
        <el-table :data="relabelLines" size="small" border>
          <el-table-column prop="sku" label="SKU" width="120" />
          <el-table-column prop="productName" label="品名" min-width="120" show-overflow-tooltip />
          <el-table-column label="扫描旧条码" min-width="160">
            <template #default="{ row }">
              <el-input v-model="row.scannedBarcode" placeholder="扫枪/键盘输入" clearable size="small" />
            </template>
          </el-table-column>
          <el-table-column label="新条码(可选)" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.newBarcode" placeholder="新标签码" clearable size="small" />
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="relabelVisible = false">取消</el-button>
        <template v-if="relabelUsesPlatformUnitLabels">
          <el-button
            type="primary"
            :disabled="!relabelLabelSummary.allPrintable"
            @click="submitRelabel(true)"
          >
            确认已完成贴标
          </el-button>
        </template>
        <template v-else>
          <el-button @click="submitRelabel(true)">跳过扫码确认</el-button>
          <el-button type="primary" @click="submitRelabel(false)">确认换标</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 完成拣货 -->
    <el-dialog v-model="pickVisible" :title="`完成拣货 · ${pickOrder?.outboundNo || ''}`" width="640px">
      <div class="pick-hint">系统已按库存自动分配拣货库位，请确认实拣数量即可。</div>
      <el-form label-width="80px" style="margin-bottom:12px">
        <el-form-item label="拣货来源">
          <el-radio-group v-model="pickSource" size="small">
            <el-radio-button value="pda">PDA</el-radio-button>
            <el-radio-button value="pick_list">拣货单</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <el-table v-loading="pickLoading" :data="pickLines" size="small" border>
        <el-table-column prop="sku" label="SKU" width="120" />
        <el-table-column label="应拣" width="70" align="right">
          <template #default="{ row }">{{ row.qty }}</template>
        </el-table-column>
        <el-table-column label="实拣" width="100">
          <template #default="{ row }">
            <el-input-number v-model="row.pickedQty" :min="1" :max="row.qty" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="拣货库位" min-width="140">
          <template #default="{ row }">
            <span v-if="row.locationCode" class="mono">{{ row.locationCode }}</span>
            <span v-else class="loc-empty">待上架</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="pickVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPick">完成拣货</el-button>
      </template>
    </el-dialog>

    <!-- 复核打包 -->
    <el-dialog
      v-model="packVisible"
      :title="`复核打包 · ${packOrder?.outboundNo || ''}`"
      width="min(980px, 94vw)"
    >
      <OutboundLabelPanel
        class="pack-label-panel"
        :detail="packOrder"
        :loading="packDetailLoading"
        :action-loading="labelActionLoading"
        @print-order="printOrderLabels(packOrder)"
        @print-sku="(line) => printSkuLabels(packOrder, line)"
        @print-unit="(line, unitIndex) => printUnitLabel(packOrder, line, unitIndex)"
      />
      <div v-if="packOrder?.needsRelabel" class="pick-hint" style="margin-bottom:12px">
        本单需换标：复核完成后将进入「待换标」，换标确认后再发运。
      </div>
      <div v-if="packOrder?.omsPreDeduct" class="pick-hint" style="margin-bottom:12px">
        OMS 预扣 ¥{{ packOrder.omsPreDeduct.preDeductTotal?.toFixed(2) }}
        <template v-if="packOrder.omsPreDeduct.totalVolumeM3 != null">
          · 试算 {{ packOrder.omsPreDeduct.totalVolumeM3?.toFixed(4) }} m³ / {{ packOrder.omsPreDeduct.totalWeightKg?.toFixed(2) }} kg
        </template>
        · 请录入实测外箱尺寸，系统将按模板实算费用
      </div>
      <div v-if="packOrder?.omsActualFees" class="pick-hint" style="margin-bottom:12px;color:var(--el-color-success)">
        已实测实算合计 ¥{{ packOrder.omsActualFees.actualTotal?.toFixed(2) }}
      </div>
      <el-form label-width="80px">
        <el-form-item v-if="packOrder?.omsPreDeduct" label="外箱实测" required>
          <div class="pack-cartons">
            <div v-for="(carton, idx) in packCartons" :key="idx" class="pack-carton-row">
              <el-input v-model="carton.lengthCm" placeholder="长 cm" style="width:72px" />
              <span class="pack-carton-x">×</span>
              <el-input v-model="carton.widthCm" placeholder="宽 cm" style="width:72px" />
              <span class="pack-carton-x">×</span>
              <el-input v-model="carton.heightCm" placeholder="高 cm" style="width:72px" />
              <el-input v-model="carton.grossWeightKg" placeholder="毛重 kg" style="width:80px;margin-left:8px" />
              <el-button v-if="packCartons.length > 1" link type="danger" @click="removePackCarton(idx)">删</el-button>
            </div>
            <el-button link type="primary" @click="addPackCarton">+ 加一箱</el-button>
          </div>
        </el-form-item>
        <el-form-item label="复核来源">
          <el-radio-group v-model="packReviewSource" size="small">
            <el-radio-button value="pda">PDA</el-radio-button>
            <el-radio-button value="pick_list">拣货单</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="打托">
          <el-checkbox v-model="packIsPalletized">已打托</el-checkbox>
        </el-form-item>
        <el-form-item label="打托信息">
          <el-input v-model="packPalletInfo" placeholder="托数、尺寸等（可选）" clearable />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="packVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPack">
          {{ packOrder?.needsRelabel ? '确认复核，去换标' : '确认复核打包' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 平台预约 -->
    <el-dialog v-model="appointmentVisible" :title="`平台预约 · ${appointmentOrder?.outboundNo || ''}`" width="420px">
      <el-form label-width="100px">
        <el-form-item label="预约状态">
          <el-select v-model="appointmentStatus" placeholder="预约状态" style="width:100%">
            <el-option v-for="a in APPOINTMENT_STATUSES" :key="a.value" :label="a.label" :value="a.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="预约送仓日">
          <el-date-picker
            v-model="appointmentDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="独立字段，可筛选/导出"
            style="width:100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="appointmentVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAppointment">保存</el-button>
      </template>
    </el-dialog>

    <!-- 上传 POD 签收单（确认送达后） -->
    <el-dialog v-model="podUploadVisible" :title="`上传POD签收单 · ${deliverOrder?.outboundNo || ''}`" width="440px">
      <div class="pick-hint">请上传平台仓签收回执（PDF / JPG / PNG），无需扫描或输入 POD 码。</div>
      <input
        ref="podFileInputRef"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        class="pod-file-input"
        @change="onPodFileChange"
      />
      <p v-if="deliverPodFile" class="pod-file-name">{{ deliverPodFile.name }}</p>
      <template #footer>
        <el-button @click="skipPodUpload">稍后上传</el-button>
        <el-button type="primary" :disabled="!deliverPodFile" @click="submitPodUpload">上传签收单</el-button>
      </template>
    </el-dialog>

    <!-- 发运 -->
    <el-dialog v-model="shipVisible" :title="`发运 · ${shipOrder?.outboundNo || ''}`" width="460px">
      <div v-if="shipOrder?.omsActualFees" class="pick-hint">
        实测实算 ¥{{ shipOrder.omsActualFees.actualTotal?.toFixed(2) }}（发运时将按此入账）
      </div>
      <div v-else-if="shipOrder?.omsPreDeduct" class="pick-hint" style="color:var(--el-color-warning)">
        尚未完成实测实算，发运将使用旧版固定单价计费
      </div>
      <div v-if="shipOrder?.omsPreDeduct && !shipOrder?.omsActualFees" class="pick-hint">
        OMS 预扣合计 ¥{{ shipOrder.omsPreDeduct.preDeductTotal?.toFixed(2) }}
        <template v-if="shipOrder.omsPreDeduct.destRegion"> · 地区 {{ String(shipOrder.omsPreDeduct.destRegion).toUpperCase() }}</template>
        <template v-if="shipOrder.omsPreDeduct.priceTemplateName"> · 模板 {{ shipOrder.omsPreDeduct.priceTemplateName }}</template>
      </div>
      <el-form label-width="80px">
        <el-form-item label="跟踪号">
          <el-input v-model="shipTrackingNo" placeholder="物流跟踪号（可选）" clearable />
        </el-form-item>
        <el-form-item label="物流产品">
          <el-select v-model="shipLogisticsProduct" clearable filterable allow-create placeholder="可选" style="width:100%">
            <el-option v-for="p in LOGISTICS_PRODUCTS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="承运商">
          <el-select v-model="shipCarrier" clearable filterable allow-create placeholder="可选" style="width:100%">
            <el-option v-for="c in CARRIERS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="shipVisible = false">取消</el-button>
        <el-button type="primary" @click="submitShip">确认发运</el-button>
      </template>
    </el-dialog>

    <!-- 分配拣货员 -->
    <el-dialog v-model="assignVisible" title="分配拣货员" width="360px">
      <p class="dialog-hint">已选 {{ assignableSelected.length }} 单（仅待拣货）</p>
      <el-select v-model="assignPickerId" placeholder="选择拣货员" style="width:100%">
        <el-option v-for="u in pickerUsers" :key="u.id" :label="u.name" :value="u.id" />
      </el-select>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssignPicker">确认分配</el-button>
      </template>
    </el-dialog>

    <!-- 标记问题件 -->
    <el-dialog v-model="problemVisible" :title="`标记问题件 · ${problemOrder?.outboundNo || ''}`" width="420px">
      <div class="problem-hint">问题件仅作提醒，出库流程可继续；与「异常」不同，异常会暂停流程。</div>
      <el-input v-model="problemRemark" type="textarea" :rows="3" placeholder="问题说明（可选）" />
      <template #footer>
        <el-button @click="problemVisible = false">取消</el-button>
        <el-button type="warning" @click="submitProblem">确认标记</el-button>
      </template>
    </el-dialog>

    <!-- 标记异常 -->
    <el-dialog v-model="exceptionVisible" :title="`标记异常 · ${exceptionOrder?.outboundNo || ''}`" width="420px">
      <div class="problem-hint">标记后出库单进入「异常」状态，流程暂停；处理完成后可解除并恢复原状态。</div>
      <el-input v-model="exceptionRemark" type="textarea" :rows="3" placeholder="异常说明（可选）" />
      <template #footer>
        <el-button @click="exceptionVisible = false">取消</el-button>
        <el-button type="danger" @click="submitException">确认标记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.outbound-page .page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.page-title {
  font-weight: 600;
  font-size: 15px;
}
.page-desc {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.filter-card {
  margin-bottom: 12px;
  padding: 12px 14px 10px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}
.filter-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px 14px;
}
.filter-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.filter-item label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.2;
}
.filter-item--span2 {
  grid-column: span 2;
}
.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color-extra-light);
}
.status-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.status-tabs {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.status-tabs :deep(.el-radio-group) {
  flex-wrap: wrap;
  gap: 4px 0;
}
.status-bar-actions {
  flex-shrink: 0;
}
.tab-count {
  margin-left: 2px;
  font-size: 11px;
  opacity: 0.85;
}
.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.outbound-table {
  width: 100%;
}
.order-no-link {
  color: var(--el-color-primary);
}
.copy-btn {
  margin-left: 4px;
  vertical-align: baseline;
}
.problem-tag {
  margin-left: 4px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.inventory-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.mono {
  font-family: ui-monospace, monospace;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.attachment-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.attachment-name {
  font-size: 13px;
  color: var(--el-color-primary);
}
.hidden-file {
  display: none;
}
.problem-hint {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pick-hint {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.legacy-relabel {
  margin-top: 14px;
}
.pack-label-panel {
  margin-bottom: 14px;
}
.pack-cartons {
  width: 100%;
}
.pack-carton-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.pack-carton-x {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.pod-file-input {
  display: block;
  width: 100%;
  margin-bottom: 8px;
}
.pod-file-name {
  margin: 0;
  font-size: 13px;
  color: var(--el-color-primary);
}
.loc-empty {
  color: var(--el-color-warning);
  font-size: 12px;
}
.dialog-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 1200px) {
  .filter-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .filter-item--span2 {
    grid-column: span 2;
  }
}
</style>
