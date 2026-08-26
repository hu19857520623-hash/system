<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { erpConfirm } from '@/utils/messageBox'
import {
  outboundApi,
  customerApi,
  usersApi,
  triggerBrowserDownload,
} from '@/api/client.js'
import { withAction } from '@/composables/useListLoader.ts'
import { useOutboundList } from '@/composables/useOutboundList.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'
import OutboundLabelPanel from '@/components/outbound/OutboundLabelPanel.vue'
import OutboundPickDialog from '@/components/outbound/OutboundPickDialog.vue'
import OutboundShipDialog from '@/components/outbound/OutboundShipDialog.vue'
import {
  buildOutboundLabelSummary,
  outboundLabelActionKey,
  type OutboundLabelAction,
  type OutboundLabelLine,
} from '@/features/outbound/labels'
import { warehouseFilterOptions } from '@/utils/omsWarehouse.ts'

const app = useAppStore()
const route = useRoute()

const {
  filterStatus,
  searchQ,
  filterCustomer,
  filterDest,
  filterSku,
  filterLogisticsProduct,
  filterPicker,
  filterNeedsRelabel,
  filterIsProblem,
  filterPlatform,
  filterAppointment,
  dateRange,
  appointmentDateRange,
  page,
  pageSize,
  listTotal,
  loading,
  orders,
  statusCounts,
  reloadAll,
  search,
  rowIndex,
  buildQueryParams,
} = useOutboundList()

const selectedRows = ref<any[]>([])

const appointmentDateShortcuts = [
  { text: '今天', value: () => { const today = new Date(); return [today, today] } },
  { text: '未来 7 天', value: () => { const start = new Date(); const end = new Date(); end.setDate(end.getDate() + 6); return [start, end] } },
  { text: '未来 30 天', value: () => { const start = new Date(); const end = new Date(); end.setDate(end.getDate() + 29); return [start, end] } },
]

const pickVisible = ref(false)
const shipVisible = ref(false)
const assignVisible = ref(false)
const problemVisible = ref(false)
const exceptionVisible = ref(false)
const packVisible = ref(false)
const appointmentVisible = ref(false)
const relabelVisible = ref(false)
const podUploadVisible = ref(false)
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailOrder = ref<any>(null)
const pickOrder = ref<any>(null)
const packOrder = ref<any>(null)
const appointmentOrder = ref<any>(null)
const relabelOrder = ref<any>(null)
const deliverOrder = ref<any>(null)
const shipOrder = ref<any>(null)
const problemOrder = ref<any>(null)
const exceptionOrder = ref<any>(null)
const packIsPalletized = ref(false)
const packPalletInfo = ref('')
const packReviewSource = ref<'pda' | 'pick_list'>('pick_list')
const packCartons = ref<{ lengthCm: string; widthCm: string; heightCm: string; grossWeightKg: string }[]>([
  { lengthCm: '', widthCm: '', heightCm: '', grossWeightKg: '' },
])
const appointmentStatus = ref('')
const appointmentDate = ref('')
const deliverPodFile = ref<File | null>(null)
const podFileInputRef = ref<HTMLInputElement | null>(null)
const assignPickerId = ref<number | null>(null)
const assignTargetIds = ref<number[]>([])
const problemRemark = ref('')
const exceptionRemark = ref('')
const problemType = ref('')
const exceptionType = ref('')
const problemTypeOptions = [
  { value: 'stock_short', label: '库存短缺' },
  { value: 'damaged', label: '货品破损' },
  { value: 'wrong_sku', label: 'SKU 不符' },
  { value: 'barcode_issue', label: '条码异常' },
  { value: 'label_missing', label: '标签缺失' },
  { value: 'other', label: '其他问题' },
]
const exceptionTypeOptions = [
  { value: 'delivery_failure', label: '配送失败' },
  { value: 'missed_booking', label: '错过预约' },
  { value: 'customer_cancelled', label: '客户取消' },
  { value: 'platform_cancelled', label: '平台取消' },
  { value: 'document_missing', label: '文件缺失' },
  { value: 'system_sync', label: '系统同步异常' },
  { value: 'other', label: '其他异常' },
]
const labelActionLoading = reactive<Record<string, boolean>>({})
const packDetailLoading = ref(false)
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
  picked: { label: '已拣货', tag: 'info' },
  reviewing: { label: '复核中', tag: 'info' },
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
    void downloadAttachmentById(row, attId)
    return
  }
  switch (command) {
    case 'detail':
      void openDetail(row)
      break
    case 'labels':
      downloadRowLabels(row)
      break
    case 'assignPicker':
      openAssignPicker(row)
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
      void downloadAttachment(row)
      break
    case 'downloadPod':
      void downloadPodAttachment(row)
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
    return selectedRows.value.filter((r) => r.status === 'picking')
  }
  return orders.value.filter((r) => r.status === 'picking')
})

function rowActionAttachments(row: any) {
  const atts = row.attachments?.length
    ? row.attachments
    : row.attachmentName && row.attachmentDownloadable
      ? [{ id: 0, fileName: row.attachmentName, fileType: 'other', downloadable: true }]
      : []
  return atts.filter(
    (att: any) => !['skuLabel', 'outerLabel'].includes(att.fileType) && att.downloadable === true,
  )
}

function attachmentActionLabel(att: any) {
  if (att.fileType === 'pod') return 'POD签收单'
  if (att.fileType === 'deliveryList') return '发货清单'
  if (att.fileType === 'appointment') return '预约单'
  return '附件'
}

type RowAction = { key: string; command: string; label: string; divided?: boolean }

function rowHasArchivableLabels(row: any) {
  const summary = buildOutboundLabelSummary(row)
  if (summary.lines.some((line) => line.printable)) return true
  return (row.attachments || []).some(
    (att: any) => ['skuLabel', 'outerLabel'].includes(att.fileType) && att.downloadable !== false,
  )
}

const detailCustomerRemark = computed(() => {
  const remark = detailOrder.value?.customerRemark ?? detailOrder.value?.remark
  return String(remark || '').trim() || '—'
})

function appendDetailCommand(cmds: RowAction[]) {
  cmds.unshift({ key: 'detail', command: 'detail', label: '查看详情' })
}

function rowCommands(row: any): RowAction[] {
  const cmds: RowAction[] = []
  const status = row.status

  if (status === 'cancelled') {
    appendDetailCommand(cmds)
    if (rowHasArchivableLabels(row)) {
      cmds.push({ key: 'labels', command: 'labels', label: '下载标签' })
    }
    for (const att of rowActionAttachments(row)) {
      const isPod = att.fileType === 'pod'
      const hasAttachmentId = Number.isFinite(att.id) && att.id > 0
      cmds.push({
        key: isPod ? 'downloadPod' : (hasAttachmentId ? `att-${att.id}` : `att-${att.fileName || att.fileType || 'file'}`),
        command: isPod ? 'downloadPod' : (hasAttachmentId ? `downloadAtt:${att.id}` : 'downloadCpt'),
        label: `下载${attachmentActionLabel(att)}`,
      })
    }
    return cmds
  }

  appendDetailCommand(cmds)

  if (status === 'pending_relabel') {
    cmds.push({ key: 'labels', command: 'labels', label: '下载标签' })
    if (canRelabel.value) cmds.push({ key: 'relabel', command: 'relabel', label: '扫码换标' })
  }
  if (status === 'pending_pick' && canPick.value) {
    cmds.push({ key: 'assignPicker', command: 'assignPicker', label: '分配拣货员' })
  }
  if (status === 'picking' && canPick.value) {
    cmds.push({ key: 'downloadPick', command: 'downloadPick', label: '下载拣货清单' })
    cmds.push({ key: 'pick', command: 'pick', label: '完成拣货' })
  }
  if (['picked', 'reviewing'].includes(status) && canPack.value) {
    cmds.push({ key: 'pack', command: 'pack', label: '复核打包' })
  }
  if (status === 'packed' && canShip.value) {
    cmds.push({ key: 'ship', command: 'ship', label: '发运' })
  }
  if (status === 'shipped' && canShip.value) {
    cmds.push({ key: 'deliver', command: 'deliver', label: '确认送达' })
  }
  if (status === 'delivered' && canCreate.value && !rowHasPod(row)) {
    cmds.push({ key: 'uploadPod', command: 'uploadPod', label: '上传POD签收单' })
  }
  if (canCreate.value && row.destType === 'fba' && status !== 'cancelled') {
    cmds.push({ key: 'appointment', command: 'appointment', label: '预约派送' })
  }

  for (const att of rowActionAttachments(row)) {
    const isPod = att.fileType === 'pod'
    const hasAttachmentId = Number.isFinite(att.id) && att.id > 0
    cmds.push({
      key: isPod ? 'downloadPod' : (hasAttachmentId ? `att-${att.id}` : `att-${att.fileName || att.fileType || 'file'}`),
      command: isPod ? 'downloadPod' : (hasAttachmentId ? `downloadAtt:${att.id}` : 'downloadCpt'),
      label: `下载${attachmentActionLabel(att)}`,
    })
  }

  if (canCreate.value && !['cancelled', 'shipped', 'delivered'].includes(status)) {
    cmds.push({
      key: 'problem',
      command: 'problem',
      label: '标记问题件',
      divided: cmds.length > 0,
    })
  }
  if (canCreate.value && status !== 'exception' && !['cancelled', 'shipped', 'delivered'].includes(status)) {
    cmds.push({ key: 'exception', command: 'exception', label: '标记异常（暂停流程）' })
  }
  if (canCreate.value && row.isProblem && status !== 'cancelled') {
    cmds.push({ key: 'clearProblem', command: 'clearProblem', label: '解除问题件' })
  }
  if (canCreate.value && status === 'exception') {
    cmds.push({ key: 'clearException', command: 'clearException', label: '解除异常' })
  }
  if (canCreate.value && !['shipped', 'delivered', 'cancelled'].includes(status)) {
    cmds.push({ key: 'cancel', command: 'cancel', label: '取消出库单' })
  }

  return cmds
}

function handleSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

async function openDetail(row: any) {
  if (!row?.id) return
  detailVisible.value = true
  detailLoading.value = true
  detailOrder.value = null
  try {
    detailOrder.value = await outboundApi.detail(row.id)
  } catch (err: any) {
    ElMessage.error(err?.message || '加载出库详情失败')
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

async function downloadAttachment(row: any) {
  try {
    const { blob, fileName } = await outboundApi.downloadAttachment(row.id)
    triggerBrowserDownload(blob, fileName || row.attachmentName || 'cpt-attachment')
  } catch (err: any) {
    ElMessage.error(err.message || '下载失败')
  }
}

async function downloadAttachmentById(row: any, attachmentId: number) {
  if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
    ElMessage.error('附件信息无效，请刷新列表后重试')
    return
  }
  try {
    const { blob, fileName } = await outboundApi.downloadAttachmentById(row.id, attachmentId)
    triggerBrowserDownload(blob, fileName || 'attachment')
  } catch (err: any) {
    ElMessage.error(err.message || '下载失败')
  }
}

async function downloadPodAttachment(row: any) {
  if (!row?.id) {
    ElMessage.warning('出库单信息不完整')
    return
  }
  try {
    const { blob, fileName } = await outboundApi.downloadPod(row.id)
    if (!blob?.size) throw new Error('POD 签收单文件为空')
    const name = fileName || `${row.outboundNo || 'outbound'}-pod.pdf`
    const mode = triggerBrowserDownload(blob, name, { preferNewTab: true })
    ElMessage.success(mode === 'tab' ? 'POD 签收单已在新窗口打开' : 'POD 签收单下载已开始')
  } catch (err: any) {
    ElMessage.error(err.message || '下载 POD 签收单失败')
  }
}

async function downloadRowLabels(row: any) {
  try {
    const { blob, fileName } = await outboundApi.downloadSkuLabels(row.id)
    triggerBrowserDownload(blob, fileName || `${row.outboundNo || 'outbound'}-labels.pdf`)
  } catch (err: any) {
    ElMessage.error(err.message || '下载标签失败')
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

function openPick(row: any) {
  pickOrder.value = row
  pickVisible.value = true
}

async function onPickSuccess() {
  filterStatus.value = 'picked'
  await reloadAll()
}

async function downloadPickList(row: any) {
  if (!canPick.value && !canExport.value) return
  try {
    await outboundApi.downloadPickList(row.id)
  } catch (err: any) {
    ElMessage.error(err.message || '下载拣货清单失败')
  }
}

function openShip(row: any) {
  shipOrder.value = row
  shipVisible.value = true
}

async function onShipSuccess() {
  await reloadAll()
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
    await erpConfirm(
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

function openAssignPicker(row?: any) {
  if (!canPick.value) return
  const rows = row ? [row] : assignableSelected.value
  const ids = rows.filter((r) => r.status === 'pending_pick').map((r) => r.id)
  if (!ids.length) {
    ElMessage.warning(row ? '仅待拣货状态可分配拣货员' : '请勾选待拣货的出库单')
    return
  }
  assignTargetIds.value = ids
  assignPickerId.value = pickerUsers.value[0]?.id ?? null
  assignVisible.value = true
}

async function submitAssignPicker() {
  if (!assignPickerId.value) {
    ElMessage.warning('请选择拣货员')
    return
  }
  if (!assignTargetIds.value.length) {
    ElMessage.warning('请勾选待拣货的出库单')
    return
  }
  const count = assignTargetIds.value.length
  await withAction(async () => {
    await outboundApi.assignPicker({
      ids: assignTargetIds.value,
      pickerId: assignPickerId.value!,
    })
    assignVisible.value = false
    selectedRows.value = []
    assignTargetIds.value = []
    filterStatus.value = 'picking'
    await reloadAll()
  }, `已分配 ${count} 单`)
}

function openProblem(row: any) {
  problemOrder.value = row
  problemType.value = row.problemType || ''
  problemRemark.value = row.problemRemark || ''
  problemVisible.value = true
}

function openException(row: any) {
  exceptionOrder.value = row
  exceptionType.value = row.exceptionType || ''
  exceptionRemark.value = row.problemRemark || ''
  exceptionVisible.value = true
}

async function submitProblem() {
  if (!problemOrder.value || !canCreate.value) return
  if (!problemType.value) { ElMessage.warning('请选择拣货问题类型'); return }
  const outboundNo = problemOrder.value.outboundNo
  const ok = await withAction(async () => {
    await outboundApi.setProblem(problemOrder.value.id, {
      markType: 'problem',
      problemType: problemType.value,
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
  if (!exceptionType.value) { ElMessage.warning('请选择订单异常类型'); return }
  const outboundNo = exceptionOrder.value.outboundNo
  const ok = await withAction(async () => {
    await outboundApi.setProblem(exceptionOrder.value.id, {
      markType: 'exception',
      exceptionType: exceptionType.value,
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
    ElMessage.warning('没有可打印的拣货中出库单')
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
  const tag = STATUS_MAP[status]?.tag
  return tag || 'info'
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
              :shortcuts="appointmentDateShortcuts"
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
            @click="openAssignPicker()"
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
            <template v-if="rowCommands(row).length">
              <el-dropdown
                trigger="click"
                :teleported="false"
                popper-class="outbound-row-dropdown"
              >
                <el-button link type="primary" size="small" @click.stop>操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-for="item in rowCommands(row)"
                      :key="item.key"
                      :divided="item.divided"
                      @click.stop="handleRowCommand(item.command, row)"
                    >
                      {{ item.label }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </el-table>

      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />
    </el-card>

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

    <OutboundPickDialog
      v-model="pickVisible"
      :order="pickOrder"
      :can-pick="canPick"
      @success="onPickSuccess"
    />

    <!-- 复核打包 -->
    <el-dialog
      v-model="packVisible"
      :title="`复核打包 · ${packOrder?.outboundNo || ''}`"
      width="min(980px, 94vw)"
    >
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

    <OutboundShipDialog
      v-model="shipVisible"
      :order="shipOrder"
      :can-ship="canShip"
      :logistics-products="LOGISTICS_PRODUCTS"
      :carriers="CARRIERS"
      @success="onShipSuccess"
    />

    <!-- 分配拣货员 -->
    <el-dialog v-model="assignVisible" title="分配拣货员" width="360px">
      <p class="dialog-hint">已选 {{ assignTargetIds.length }} 单（仅待拣货）</p>
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
      <el-select v-model="problemType" placeholder="请选择拣货问题类型" style="width:100%;margin-bottom:12px">
        <el-option v-for="item in problemTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-input v-model="problemRemark" type="textarea" :rows="3" placeholder="问题说明（可选）" />
      <template #footer>
        <el-button @click="problemVisible = false">取消</el-button>
        <el-button type="warning" @click="submitProblem">确认标记</el-button>
      </template>
    </el-dialog>

    <!-- 标记异常 -->
    <el-dialog v-model="exceptionVisible" :title="`标记异常 · ${exceptionOrder?.outboundNo || ''}`" width="420px">
      <div class="problem-hint">标记后出库单进入「异常」状态，流程暂停；处理完成后可解除并恢复原状态。</div>
      <el-select v-model="exceptionType" placeholder="请选择订单异常类型" style="width:100%;margin-bottom:12px">
        <el-option v-for="item in exceptionTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-input v-model="exceptionRemark" type="textarea" :rows="3" placeholder="异常说明（可选）" />
      <template #footer>
        <el-button @click="exceptionVisible = false">取消</el-button>
        <el-button type="danger" @click="submitException">确认标记</el-button>
      </template>
    </el-dialog>

    <!-- 出库详情 -->
    <el-dialog
      v-model="detailVisible"
      :title="`出库详情 · ${detailOrder?.outboundNo || ''}`"
      width="760px"
      class="outbound-detail-dialog erp-detail"
      destroy-on-close
    >
      <div v-loading="detailLoading">
        <template v-if="detailOrder">
          <DetailSheet
            :kicker="detailOrder.outboundNo"
            :title="detailOrder.destination || detailOrder.warehouseCode || '出库单'"
            :subtitle="[customerLabel(detailOrder), detailOrder.logisticsProduct].filter(Boolean).join(' · ')"
          >
            <template #status>
              <el-tag :type="statusTag(detailOrder.status) as any" size="small">
                {{ statusLabel(detailOrder.status) }}
              </el-tag>
            </template>
          </DetailSheet>
          <el-descriptions :column="3" border size="small" class="detail-desc">
            <el-descriptions-item label="出库单号">
              <span class="mono">{{ detailOrder.outboundNo }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTag(detailOrder.status) as any" size="small">
                {{ statusLabel(detailOrder.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="出库仓">
              <span class="mono">{{ detailOrder.warehouseCode || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="目的地">{{ detailOrder.destination || '—' }}</el-descriptions-item>
            <el-descriptions-item label="物流产品">{{ detailOrder.logisticsProduct || '—' }}</el-descriptions-item>
            <el-descriptions-item label="跟踪号">{{ detailOrder.trackingNo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="箱货类型">{{ cargoTypeLabel(detailOrder) }}</el-descriptions-item>
            <el-descriptions-item label="件数">{{ detailOrder.totalQty ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ detailOrder.createdAt || '—' }}</el-descriptions-item>
            <el-descriptions-item label="客户备注" :span="3">
              <span class="remark-text">{{ detailCustomerRemark }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="detail-section-title">SKU 明细</div>
          <el-table :data="detailOrder.items || []" border size="small" empty-text="暂无 SKU 明细">
            <el-table-column prop="sku" label="SKU" width="140">
              <template #default="{ row }"><span class="mono">{{ row.sku || '—' }}</span></template>
            </el-table-column>
            <el-table-column prop="productName" label="品名" min-width="160" show-overflow-tooltip />
            <el-table-column prop="qty" label="数量" width="80" align="right" />
            <el-table-column prop="pickedQty" label="已拣" width="80" align="right">
              <template #default="{ row }">{{ row.pickedQty ?? 0 }}</template>
            </el-table-column>
            <el-table-column prop="locationCode" label="库位" width="100">
              <template #default="{ row }"><span class="mono">{{ row.locationCode || '—' }}</span></template>
            </el-table-column>
          </el-table>
        </template>
      </div>
      <template #footer>
        <el-button type="primary" @click="detailVisible = false">关闭</el-button>
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
.detail-desc { margin-bottom: 16px; }
.detail-section-title { font-weight: 600; font-size: 13px; margin: 4px 0 8px; }
.remark-text { white-space: pre-wrap; word-break: break-word; }

.outbound-table :deep(.el-table__fixed-right),
.outbound-table :deep(.el-table-fixed-column--right) {
  overflow: visible;
}
.outbound-table :deep(.el-dropdown) {
  vertical-align: middle;
}
:deep(.outbound-row-dropdown) {
  z-index: 20;
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
