<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { returnsApi, operationLogApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'

const app = useAppStore()

type StatusFilter = 'all' | 'cancelled' | 'pending_arrival' | 'received' | 'measured' | 'fee_calculated' | 'awaiting_customer' | 'accepted_pending' | 'dispose_pending' | 'completed' | 'issue'
type CartonForm = { lengthCm: string; widthCm: string; heightCm: string; grossWeightKg: string }
type CodeField = 'returnNo' | 'orderNo' | 'trackingNo' | 'referenceNo'

const filter = ref<StatusFilter>('all')
const processFilter = ref('')
const customerCode = ref('')
const returnWarehouse = ref('')
const codeField = ref<CodeField>('returnNo')
const codeValue = ref('')
const skuFilter = ref('')
const sellerTaxNo = ref('')
const expectedArrivalRange = ref<[string, string] | null>(null)

const page = ref(1)
const pageSize = ref(20)
const listTotal = ref(0)
const loading = ref(false)
const rows = ref<any[]>([])
const selectedIds = ref<number[]>([])

const processDialog = ref(false)
const processTarget = ref<any>(null)
const processResultForm = ref('restock')
const processRemark = ref('')

const detailVisible = ref(false)
const detailRow = ref<any>(null)
const detailLoading = ref(false)

const logVisible = ref(false)
const logLoading = ref(false)
const logRows = ref<any[]>([])
const logTarget = ref<any>(null)

const receiveDialog = ref(false)
const receiveTarget = ref<any>(null)
const receiveQty = ref('')
const receiveCartons = ref('')
const receiveRemark = ref('')
const receiveSubmitting = ref(false)

const measureDialog = ref(false)
const measureTarget = ref<any>(null)
const measureCartons = ref<CartonForm[]>([])
const measureSubmitting = ref(false)

const inspectDialog = ref(false)
const inspectTarget = ref<any>(null)
const inspectResult = ref('unknown')
const inspectRemark = ref('')
const inspectPhotos = ref<{ fileName: string; contentBase64: string }[]>([])
const inspectSubmitting = ref(false)
const inspectFileRef = ref<HTMLInputElement | null>(null)

const INSPECTION_OPTIONS = [
  { value: 'good', label: '良品' },
  { value: 'defective', label: '不良品' },
  { value: 'mixed', label: '混合' },
  { value: 'unknown', label: '待判定' },
]

const VOLUMETRIC_DIVISOR = 5000

const RETURN_WAREHOUSE_LIST = [
  { value: 'JHB3', label: 'JHB3' },
  { value: 'CPT2', label: 'CPT2' },
  { value: 'DBN', label: 'DBN' },
]
type ExtraFeeForm = { description: string; amount: string }

const extraFeeLines = ref<ExtraFeeForm[]>([])
const feePreview = ref<any>(null)
const feePreviewLoading = ref(false)
const feeTemplates = ref<any[]>([])
const templateDialogVisible = ref(false)
const editingTemplateId = ref<number | 'new' | null>(null)
const editingTemplate = ref<any>(null)
const templateSaving = ref(false)
let feePreviewTimer: ReturnType<typeof setTimeout> | null = null

const FEE_CALC_MODE_OPTIONS = [
  { value: 'fixed', label: '固定/单' },
  { value: 'per_carton', label: '按箱数' },
  { value: 'per_sku', label: '按SKU件数' },
  { value: 'per_cbm', label: '按体积CBM' },
  { value: 'per_chargeable_weight', label: '按体积重kg' },
]

const FEE_CHARGE_TYPE_OPTIONS = [
  { value: 'return_logistics', label: '退件物流费' },
  { value: 'return_inspection', label: '质检/拍照费' },
  { value: 'return_repack', label: '包装费' },
  { value: 'return_restock', label: '上架费' },
  { value: 'return_relabel', label: '换标费' },
  { value: 'return_destroy', label: '销毁费' },
]

const measureSkuQty = computed(() => {
  if (!measureTarget.value) return 0
  const row = measureTarget.value
  if (row.receivedQty != null) return Number(row.receivedQty)
  if (row.totalQty != null) return Number(row.totalQty)
  return (row.items || []).reduce((s: number, i: { quantity?: number }) => s + (i.quantity || 0), 0)
})

const previewVolume = computed(() => {
  let total = 0
  for (const c of measureCartons.value) {
    total += cartonVolume(c)
  }
  return total
})

const previewCartons = computed(() =>
  measureCartons.value.map((c, index) => {
    const l = Number(c.lengthCm)
    const w = Number(c.widthCm)
    const h = Number(c.heightCm)
    const volumeCbm = cartonVolume(c)
    const volumetricWeightKg = l > 0 && w > 0 && h > 0 ? (l * w * h) / VOLUMETRIC_DIVISOR : 0
    const grossWeightKg = Number(c.grossWeightKg) || 0
    const chargeableWeightKg = Math.max(grossWeightKg, volumetricWeightKg)
    return {
      cartonNo: index + 1,
      volumeCbm,
      volumetricWeightKg,
      chargeableWeightKg,
      valid: volumeCbm > 0,
    }
  }),
)

const measureFeeTitle = computed(() => {
  const wh = measureTarget.value?.returnWarehouse || '—'
  const tplName = feePreview.value?.template?.templateName
  return tplName ? `退件费用（${wh} · ${tplName}）` : `退件费用（${wh} · 按仓库模板）`
})

const configuredWarehouseSet = computed(() => new Set(feeTemplates.value.map((t: any) => t.warehouseCode)))

const missingWarehouses = computed(() =>
  RETURN_WAREHOUSE_LIST.filter(w => !configuredWarehouseSet.value.has(w.value)),
)

const previewChargeableWeight = computed(() =>
  previewCartons.value.reduce((s, c) => s + (c.valid ? c.chargeableWeightKg : 0), 0),
)

const previewFeeTotal = computed(() => Number(feePreview.value?.estimatedTotal ?? 0))

function cartonVolume(c: CartonForm) {
  const l = Number(c.lengthCm)
  const w = Number(c.widthCm)
  const h = Number(c.heightCm)
  if (l <= 0 || w <= 0 || h <= 0) return 0
  return (l * w * h) / 1_000_000
}

function emptyCarton(): CartonForm {
  return { lengthCm: '', widthCm: '', heightCm: '', grossWeightKg: '' }
}

const WAREHOUSE_OPTIONS = [
  { value: '', label: '全部仓库' },
  { value: 'JHB3', label: 'JHB3' },
  { value: 'CPT2', label: 'CPT2' },
  { value: 'DBN', label: 'DBN' },
]

const PROCESS_OPTIONS = [
  { value: 'pending_inspection', label: '检查拍照' },
  { value: 'restock', label: '直接上架' },
  { value: 'relabel', label: '换标上架' },
  { value: 'other_issue', label: '等问题' },
]

const CODE_FIELD_OPTIONS = [
  { value: 'returnNo', label: '退件单号' },
  { value: 'orderNo', label: '订单号' },
  { value: 'trackingNo', label: '跟踪号' },
  { value: 'referenceNo', label: '参考号' },
]

const STATUS_LABELS: Record<string, string> = {
  pending_arrival: '在途',
  received: '已收货',
  measured: '已测体积',
  fee_calculated: '已算费',
  awaiting_customer: '待客户确认',
  accepted_pending: '待仓库作业',
  dispose_pending: '待销毁',
  arrived: '已到货',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已作废',
}

const STATUS_TABS = [
  { value: 'all' as const, label: '全部' },
  { value: 'pending_arrival' as const, label: '在途' },
  { value: 'received' as const, label: '已收货' },
  { value: 'measured' as const, label: '已测体积' },
  { value: 'fee_calculated' as const, label: '已算费' },
  { value: 'awaiting_customer' as const, label: '待客户确认' },
  { value: 'accepted_pending' as const, label: '待作业' },
  { value: 'dispose_pending' as const, label: '待销毁' },
  { value: 'completed' as const, label: '已完成' },
  { value: 'cancelled' as const, label: '已作废' },
  { value: 'issue' as const, label: '问题件' },
]

function formatTime(v?: string | null) {
  if (!v) return '—'
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 19).replace('T', ' ')
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return s.slice(0, 19)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function statusTagType(status: string) {
  if (status === 'cancelled') return 'info'
  if (status === 'pending_arrival') return 'warning'
  if (status === 'received' || status === 'measured') return 'warning'
  if (status === 'fee_calculated' || status === 'awaiting_customer') return 'primary'
  if (status === 'accepted_pending' || status === 'dispose_pending') return 'warning'
  if (status === 'completed') return 'success'
  return 'info'
}

function formatFee(v?: number | null) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `${Number(v).toFixed(2)} RMB`
}

function formatCbm(v?: number | null) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toFixed(4)
}

function warehouseLabel(code?: string | null) {
  if (!code) return '—'
  const upper = String(code).toUpperCase()
  if (upper === 'WMS-JHB-01' || upper.includes('JHB')) return 'JHB'
  return code
}

function buildParams() {
  const params: Record<string, unknown> = {
    page: page.value,
    pageSize: pageSize.value,
  }
  if (filter.value === 'issue') {
    params.requestedProcess = 'other_issue'
  } else if (filter.value !== 'all') {
    params.status = filter.value
  }
  if (processFilter.value) params.requestedProcess = processFilter.value
  const cc = customerCode.value.trim()
  if (cc) params.customerCode = cc
  if (returnWarehouse.value) params.returnWarehouse = returnWarehouse.value
  const code = codeValue.value.trim()
  if (code) {
    params[codeField.value] = code
  }
  const sku = skuFilter.value.trim()
  if (sku) params.sku = sku
  const tax = sellerTaxNo.value.trim()
  if (tax) params.sellerTaxNo = tax
  if (expectedArrivalRange.value?.[0]) params.expectedArrivalFrom = expectedArrivalRange.value[0]
  if (expectedArrivalRange.value?.[1]) params.expectedArrivalTo = expectedArrivalRange.value[1]
  return params
}

function itemStats(row: any, item: { quantity: number }) {
  const qty = item.quantity || 0
  const received = ['received', 'measured', 'fee_calculated', 'arrived', 'processing', 'completed'].includes(row.status)
    ? (row.receivedQty ?? qty)
    : 0
  const pendingRestock = row.status === 'completed' && row.processResult === 'restock' ? qty : 0
  const good = row.status === 'completed' && row.processResult === 'restock' ? qty : 0
  return { received, pendingRestock, good, defective: 0, spare: 0, destroy: 0 }
}

const tableRows = computed(() =>
  rows.value.map((r, index) => ({
    ...r,
    rowNo: (page.value - 1) * pageSize.value + index + 1,
    statusLabel: r.statusLabel || STATUS_LABELS[r.status] || r.status,
    requestedProcessLabel: r.requestedProcessLabel || r.requestedProcess,
    processResultLabel: r.processResultLabel || r.processResult || '—',
    warehouseLabel: warehouseLabel(r.returnWarehouse),
  })),
)

async function loadList() {
  loading.value = true
  try {
    const res = await returnsApi.list(buildParams())
    rows.value = res.items || []
    listTotal.value = res.total || 0
    selectedIds.value = []
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  loadList()
}

function resetFilters() {
  filter.value = 'all'
  processFilter.value = ''
  customerCode.value = ''
  returnWarehouse.value = ''
  codeField.value = 'returnNo'
  codeValue.value = ''
  skuFilter.value = ''
  sellerTaxNo.value = ''
  expectedArrivalRange.value = null
  page.value = 1
  loadList()
}

function setStatusFilter(v: StatusFilter) {
  filter.value = v
  if (v === 'issue') processFilter.value = ''
  page.value = 1
}

function setProcessFilter(v: string) {
  processFilter.value = v
  if (v) filter.value = 'all'
  page.value = 1
}

function toggleSelect(id: number, checked: boolean) {
  if (checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id)
  } else {
    selectedIds.value = selectedIds.value.filter(x => x !== id)
  }
}

function toggleSelectAll(checked: boolean) {
  selectedIds.value = checked ? tableRows.value.map(r => r.id) : []
}

function openReceive(row: any) {
  receiveTarget.value = row
  receiveQty.value = String(row.totalQty ?? row.receivedQty ?? '')
  receiveCartons.value = String(row.receivedCartonCount ?? 1)
  receiveRemark.value = row.remark || ''
  receiveDialog.value = true
}

async function submitReceive() {
  if (!receiveTarget.value) return
  receiveSubmitting.value = true
  try {
    const updated = await returnsApi.receive(receiveTarget.value.id, {
      receivedQty: Number(receiveQty.value),
      receivedCartonCount: Number(receiveCartons.value),
      remark: receiveRemark.value.trim() || undefined,
    })
    receiveDialog.value = false
    ElMessage.success('收货完成，请测量外箱并确认费用')
    openMeasure({ ...receiveTarget.value, ...updated })
  } catch (e: any) {
    ElMessage.error(e?.message || '收货失败')
  } finally {
    receiveSubmitting.value = false
  }
}

function openMeasure(row: any) {
  measureTarget.value = row
  const count = Math.max(1, Number(row.receivedCartonCount) || 1)
  if (row.cartons?.length) {
    measureCartons.value = row.cartons.map((c: any) => ({
      lengthCm: String(c.lengthCm ?? ''),
      widthCm: String(c.widthCm ?? ''),
      heightCm: String(c.heightCm ?? ''),
      grossWeightKg: String(c.grossWeightKg ?? ''),
    }))
  } else {
    measureCartons.value = Array.from({ length: count }, () => emptyCarton())
  }
  extraFeeLines.value = (row.feeLines || [])
    .filter((l: any) => l.chargeType === 'return_extra')
    .map((l: any) => ({ description: l.description, amount: String(l.amount ?? '') }))
  feePreview.value = null
  measureDialog.value = true
  scheduleFeePreview()
}

function buildMeasureCartonPayload() {
  return measureCartons.value.map(c => ({
    lengthCm: Number(c.lengthCm),
    widthCm: Number(c.widthCm),
    heightCm: Number(c.heightCm),
    grossWeightKg: Number(c.grossWeightKg) || 0,
  }))
}

function buildExtraFeePayload() {
  return extraFeeLines.value
    .map(l => ({ description: l.description.trim(), amount: Number(l.amount) }))
    .filter(l => l.description && l.amount > 0)
}

async function refreshFeePreview() {
  if (!measureTarget.value) return
  const cartons = buildMeasureCartonPayload()
  if (!cartons.length || cartons.some(c => c.lengthCm <= 0 || c.widthCm <= 0 || c.heightCm <= 0)) {
    feePreview.value = null
    return
  }
  feePreviewLoading.value = true
  try {
    feePreview.value = await returnsApi.previewFees(measureTarget.value.id, {
      cartons,
    })
  } catch {
    feePreview.value = null
  } finally {
    feePreviewLoading.value = false
  }
}

function scheduleFeePreview() {
  if (feePreviewTimer) clearTimeout(feePreviewTimer)
  feePreviewTimer = setTimeout(() => void refreshFeePreview(), 280)
}

function addExtraFeeLine() {
  extraFeeLines.value.push({ description: '', amount: '' })
}

function removeExtraFeeLine(index: number) {
  extraFeeLines.value.splice(index, 1)
  scheduleFeePreview()
}

async function openFeeTemplates() {
  templateDialogVisible.value = true
  cancelEditTemplate()
  try {
    feeTemplates.value = await returnsApi.listFeeTemplates()
  } catch (e: any) {
    ElMessage.error(e?.message || '加载收费模板失败')
  }
}

function defaultTemplateRule(warehouse?: string) {
  const hints: Record<string, { price: number; min: number | '' }> = {
    JHB3: { price: 4, min: '' },
    CPT2: { price: 6, min: 8 },
    DBN: { price: 7, min: 8 },
  }
  const h = hints[String(warehouse || 'JHB3').toUpperCase()] || hints.JHB3
  return {
    chargeType: 'return_logistics',
    description: '退件物流费',
    calcMode: 'per_chargeable_weight',
    unitPrice: h.price,
    minQty: h.min === '' ? '' : h.min,
    sortOrder: 1,
    autoApply: true,
  }
}

function startCreateTemplate(warehouse: string) {
  if (!app.hasPerm('return.receive')) return
  editingTemplateId.value = 'new'
  editingTemplate.value = {
    id: null,
    templateCode: '',
    templateName: `${warehouse} 退件收费`,
    warehouseCode: warehouse,
    rules: [defaultTemplateRule(warehouse)],
  }
}

function startEditTemplate(tpl: any) {
  if (!app.hasPerm('return.receive')) return
  editingTemplateId.value = tpl.id
  editingTemplate.value = {
    id: tpl.id,
    templateCode: tpl.templateCode,
    templateName: tpl.templateName,
    warehouseCode: tpl.warehouseCode || '',
    rules: (tpl.rules || []).map((r: any, i: number) => ({
      chargeType: r.chargeType || 'return_logistics',
      description: r.description || '',
      calcMode: r.calcMode || 'per_chargeable_weight',
      unitPrice: r.unitPrice ?? 0,
      minQty: r.minQty ?? '',
      sortOrder: r.sortOrder ?? i + 1,
      autoApply: r.autoApply !== false,
    })),
  }
}

async function deleteTemplate(tpl: any) {
  if (!app.hasPerm('return.receive')) return
  try {
    await ElMessageBox.confirm(
      `确定删除 ${tpl.warehouseCode || tpl.templateName} 的收费模板？删除后该仓库退件测体积将无法算费，直至重新创建。`,
      '删除收费模板',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await returnsApi.deleteFeeTemplate(tpl.id)
    ElMessage.success('收费模板已删除')
    feeTemplates.value = feeTemplates.value.filter((t: any) => t.id !== tpl.id)
    if (editingTemplateId.value === tpl.id) cancelEditTemplate()
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}

function cancelEditTemplate() {
  editingTemplateId.value = null
  editingTemplate.value = null
}

function addTemplateRule() {
  if (!editingTemplate.value) return
  editingTemplate.value.rules.push({
    chargeType: 'return_logistics',
    description: '',
    calcMode: 'per_chargeable_weight',
    unitPrice: 0,
    minQty: '',
    sortOrder: editingTemplate.value.rules.length + 1,
    autoApply: true,
  })
}

function removeTemplateRule(index: number) {
  if (!editingTemplate.value?.rules?.length) return
  if (editingTemplate.value.rules.length <= 1) {
    ElMessage.warning('至少保留 1 条收费规则')
    return
  }
  editingTemplate.value.rules.splice(index, 1)
}

async function saveTemplate() {
  if (!editingTemplate.value) return
  if (!editingTemplate.value.warehouseCode) {
    ElMessage.warning('请选择适用仓库')
    return
  }
  templateSaving.value = true
  try {
    const payload = {
      templateName: String(editingTemplate.value.templateName || '').trim(),
      warehouseCode: editingTemplate.value.warehouseCode,
      rules: editingTemplate.value.rules.map((r: any, i: number) => ({
        chargeType: r.chargeType,
        description: String(r.description || '').trim(),
        calcMode: r.calcMode,
        unitPrice: Number(r.unitPrice),
        minQty: r.minQty === '' || r.minQty == null ? null : Number(r.minQty),
        sortOrder: Number(r.sortOrder) || i + 1,
        autoApply: r.autoApply !== false,
      })),
    }
    if (editingTemplateId.value === 'new') {
      const created = await returnsApi.createFeeTemplate(payload)
      ElMessage.success('收费模板已创建')
      feeTemplates.value = [...feeTemplates.value, created].sort((a: any, b: any) =>
        String(a.warehouseCode).localeCompare(String(b.warehouseCode)),
      )
    } else {
      const updated = await returnsApi.updateFeeTemplate(editingTemplate.value.id, payload)
      ElMessage.success('收费模板已保存')
      const idx = feeTemplates.value.findIndex((t: any) => t.id === updated.id)
      if (idx >= 0) feeTemplates.value[idx] = updated
    }
    cancelEditTemplate()
    if (measureDialog.value) scheduleFeePreview()
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    templateSaving.value = false
  }
}

function calcModeLabel(mode: string) {
  return FEE_CALC_MODE_OPTIONS.find(o => o.value === mode)?.label || mode
}

function calcModeHint(mode: string) {
  const map: Record<string, string> = {
    fixed: '每单固定收取',
    per_carton: '按实收外箱数 × 单价',
    per_sku: '按实收/SKU件数 × 单价',
    per_cbm: '按总体积CBM × 单价，可设最低CBM',
    per_chargeable_weight: '体积重 = 长×宽×高÷5000 (cm)，计费重 = max(毛重, 体积重)，按 kg × 单价，可设最低 kg',
  }
  return map[mode] || ''
}

function addMeasureCarton() {
  measureCartons.value.push(emptyCarton())
  scheduleFeePreview()
}

function removeMeasureCarton(index: number) {
  if (measureCartons.value.length <= 1) return
  measureCartons.value.splice(index, 1)
  scheduleFeePreview()
}

async function submitMeasure() {
  if (!measureTarget.value) return
  if (previewVolume.value <= 0) {
    ElMessage.warning('请填写每箱有效的外箱尺寸')
    return
  }
  measureSubmitting.value = true
  try {
    await returnsApi.measure(measureTarget.value.id, {
      cartons: buildMeasureCartonPayload(),
    })
    const feeResult = await returnsApi.calculateFees(measureTarget.value.id, {})
    const feeTotal = feeResult?.estimatedFeeTotal ?? previewFeeTotal.value
    ElMessage.success(`测量完成，退件物流费 ${formatFee(feeTotal)} 已生成；其余费用待客户确认后收取`)
    measureDialog.value = false
    await loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || '测量或算费失败')
  } finally {
    measureSubmitting.value = false
  }
}

function openInspect(row: any) {
  inspectTarget.value = row
  inspectResult.value = row.inspectionResult || 'unknown'
  inspectRemark.value = row.inspectionRemark || ''
  inspectPhotos.value = []
  inspectDialog.value = true
}

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

async function onInspectFiles(files: FileList | null) {
  if (!files?.length) return
  for (const file of Array.from(files)) {
    inspectPhotos.value.push({
      fileName: file.name,
      contentBase64: await readFileAsBase64(file),
    })
  }
  if (inspectFileRef.value) inspectFileRef.value.value = ''
}

async function submitInspect() {
  if (!inspectTarget.value) return
  if (!inspectPhotos.value.length) {
    ElMessage.warning('请至少上传 1 张质检照片')
    return
  }
  inspectSubmitting.value = true
  try {
    await returnsApi.submitInspection(inspectTarget.value.id, {
      inspectionResult: inspectResult.value,
      inspectionRemark: inspectRemark.value.trim() || undefined,
      attachments: inspectPhotos.value,
    })
    ElMessage.success('质检已提交，已推送客户确认')
    inspectDialog.value = false
    await loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    inspectSubmitting.value = false
  }
}

async function handleDispose(row: any) {
  if (!app.hasPerm('return.process')) return
  try {
    await ElMessageBox.confirm(`确认退件单 ${row.returnNo} 已销毁？`, '确认销毁')
    await returnsApi.dispose(row.id, { processRemark: '客户确认不留，仓库已销毁' })
    ElMessage.success('已确认销毁')
    await loadList()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e?.message || '操作失败')
  }
}

function openProcess(row: any) {
  processTarget.value = row
  processResultForm.value = row.customerProcessChoice || row.requestedProcess || 'restock'
  processRemark.value = ''
  processDialog.value = true
}

async function submitProcess() {
  if (!processTarget.value) return
  try {
    await returnsApi.process(processTarget.value.id, {
      processResult: processResultForm.value,
      processRemark: processRemark.value.trim() || undefined,
    })
    ElMessage.success('处理完成')
    processDialog.value = false
    await loadList()
  } catch (e: any) {
    ElMessage.error(e?.message || '处理失败')
  }
}

async function downloadAttachment(row: any, att: { id: number; fileName: string }) {
  try {
    await returnsApi.downloadAttachment(row.id, att.id)
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  }
}

async function openDetail(row: any) {
  detailVisible.value = true
  detailLoading.value = true
  detailRow.value = row
  try {
    detailRow.value = await returnsApi.detail(row.id)
  } catch {
    // 列表数据仍可展示
  } finally {
    detailLoading.value = false
  }
}

async function openLog(row: any) {
  logVisible.value = true
  logTarget.value = row
  logLoading.value = true
  logRows.value = []
  try {
    const res = await operationLogApi.list({
      module: 'returns',
      targetId: row.returnNo,
      pageSize: 50,
    })
    logRows.value = res.items || []
  } catch (e: any) {
    ElMessage.error(e?.message || '加载日志失败')
  } finally {
    logLoading.value = false
  }
}

function exportCsv() {
  if (!tableRows.value.length) {
    ElMessage.warning('暂无数据可导出')
    return
  }
  const headers = ['退件单号', '客户', '订单号', '仓库', '跟踪号', 'SKU', '数量', '退件原因', '期望处理', '状态', '处理结果', '预计到货', '创建时间']
  const lines = tableRows.value.map(r => [
    r.returnNo,
    r.omsCustomerCode || '',
    r.orderNo,
    r.returnWarehouse || '',
    r.trackingNo || '',
    r.items?.map((i: any) => i.sku).join(';') || '',
    r.totalQty ?? '',
    r.returnReason || '',
    r.requestedProcessLabel || '',
    r.statusLabel || '',
    r.processResultLabel || '',
    formatTime(r.expectedArrivalAt),
    formatTime(r.createdAt),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  const csv = '\ufeff' + [headers.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `returns_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

watch([filter, processFilter, page, pageSize], () => loadList())

watch(measureCartons, () => scheduleFeePreview(), { deep: true })
watch(extraFeeLines, () => scheduleFeePreview(), { deep: true })

onMounted(loadList)
</script>

<template>
  <div class="return-mgmt">
    <div class="page-header">
      <div>
        <h1 class="page-title">退件管理</h1>
        <p class="page-desc">OMS 预约退件 · 仓库收货、清点与处理（参考 WMS 退件作业视图）</p>
      </div>
    </div>

    <div class="filter-board">
      <div class="filter-group">
        <span class="filter-group-label">状态</span>
        <div class="filter-tags">
          <button
            v-for="t in STATUS_TABS"
            :key="t.value"
            type="button"
            class="filter-tag"
            :class="{ active: filter === t.value }"
            @click="setStatusFilter(t.value)"
          >{{ t.label }}</button>
        </div>
      </div>

      <div class="filter-group">
        <span class="filter-group-label">处理方式</span>
        <div class="filter-tags">
          <button
            type="button"
            class="filter-tag"
            :class="{ active: !processFilter }"
            @click="setProcessFilter('')"
          >全部</button>
          <button
            v-for="o in PROCESS_OPTIONS"
            :key="o.value"
            type="button"
            class="filter-tag"
            :class="{ active: processFilter === o.value }"
            @click="setProcessFilter(o.value)"
          >{{ o.label }}</button>
        </div>
      </div>

      <div class="search-row">
        <div class="search-item">
          <label>仓库</label>
          <el-select v-model="returnWarehouse" size="small" clearable placeholder="全部仓库" style="width: 140px">
            <el-option v-for="w in WAREHOUSE_OPTIONS" :key="w.value || 'all'" :label="w.label" :value="w.value" />
          </el-select>
        </div>
        <div class="search-item">
          <label>客户代码</label>
          <el-input v-model="customerCode" size="small" clearable placeholder="客户编码" style="width: 120px" />
        </div>
        <div class="search-item search-item-wide">
          <label>编码</label>
          <div class="code-search">
            <el-select v-model="codeField" size="small" style="width: 100px">
              <el-option v-for="c in CODE_FIELD_OPTIONS" :key="c.value" :label="c.label" :value="c.value" />
            </el-select>
            <el-input
              v-model="codeValue"
              size="small"
              clearable
              placeholder="支持模糊查询，空格分隔多个"
              style="width: 240px"
              @keyup.enter="search"
            />
          </div>
        </div>
        <div class="search-item">
          <label>产品代码</label>
          <el-input v-model="skuFilter" size="small" clearable placeholder="SKU" style="width: 130px" />
        </div>
        <div class="search-item">
          <label>买家税号</label>
          <el-input v-model="sellerTaxNo" size="small" clearable placeholder="卖家税号" style="width: 120px" />
        </div>
        <div class="search-item search-item-wide">
          <label>预计到货时间</label>
          <el-date-picker
            v-model="expectedArrivalRange"
            type="daterange"
            size="small"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 240px"
          />
        </div>
        <div class="search-actions">
          <el-button type="primary" size="small" @click="search">查询</el-button>
          <el-button size="small" @click="resetFilters">重置</el-button>
        </div>
      </div>
    </div>

    <div class="table-toolbar">
      <div class="toolbar-left">
        <el-button size="small" disabled title="功能开发中">强制收货完成</el-button>
        <el-button size="small" disabled title="功能开发中">打印退件单号</el-button>
        <el-button size="small" disabled title="功能开发中">重新收货</el-button>
      </div>
      <div class="toolbar-right">
        <el-button size="small" @click="openFeeTemplates">收费模板</el-button>
        <el-button size="small" @click="exportCsv">导出</el-button>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="tableRows"
      border
      size="small"
      class="return-table"
      :header-cell-style="{ background: '#eef3fb', color: '#334155', fontWeight: 600 }"
    >
      <el-table-column width="52" align="center" fixed="left">
        <template #header>
          <el-checkbox
            :model-value="tableRows.length > 0 && selectedIds.length === tableRows.length"
            :indeterminate="selectedIds.length > 0 && selectedIds.length < tableRows.length"
            @change="(v: boolean) => toggleSelectAll(v)"
          />
        </template>
        <template #default="{ row }">
          <div class="no-cell">
            <el-checkbox
              :model-value="selectedIds.includes(row.id)"
              @change="(v: boolean) => toggleSelect(row.id, v)"
            />
            <span class="row-no">{{ row.rowNo }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="退件信息" min-width="260">
        <template #default="{ row }">
          <div class="info-block">
            <div><span class="lbl">仓库</span>{{ row.warehouseLabel }}</div>
            <div><span class="lbl">退件单号</span><span class="mono link" @click="openDetail(row)">{{ row.returnNo }}</span></div>
            <div v-if="row.referenceNo"><span class="lbl">参考号</span><span class="mono">{{ row.referenceNo }}</span></div>
            <div><span class="lbl">跟踪号</span><span class="mono">{{ row.trackingNo || '—' }}</span></div>
            <div><span class="lbl">退件类型</span>OMS 预约退件</div>
            <div><span class="lbl">客户代码</span><span class="mono">{{ row.omsCustomerCode || '—' }}</span></div>
            <div>
              <span class="lbl">状态</span>
              <el-tag :type="statusTagType(row.status)" size="small">{{ row.statusLabel }}</el-tag>
            </div>
            <div v-if="row.sellerStoreName"><span class="lbl">卖家店铺</span>{{ row.sellerStoreName }}</div>
            <div v-if="row.sellerTaxNo"><span class="lbl">卖家税号</span>{{ row.sellerTaxNo }}</div>
            <div><span class="lbl">订单号</span><span class="mono">{{ row.orderNo }}</span></div>
            <div v-if="row.totalVolumeCbm != null"><span class="lbl">总体积</span>{{ formatCbm(row.totalVolumeCbm) }} CBM</div>
            <div v-if="row.estimatedFeeTotal != null"><span class="lbl">预估费用</span>{{ formatFee(row.estimatedFeeTotal) }}</div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="退件明细" min-width="300">
        <template #default="{ row }">
          <div v-for="item in row.items || []" :key="item.id || item.sku" class="item-block">
            <div class="item-sku mono">{{ item.sku }}</div>
            <div class="item-line"><span class="lbl">退件数量</span>{{ item.quantity }}</div>
            <div class="item-line"><span class="lbl">处理方式</span>{{ row.requestedProcessLabel || row.requestedProcess }}</div>
            <div class="item-stats">
              <span>实收: {{ itemStats(row, item).received }}</span>
              <span>待上架: {{ itemStats(row, item).pendingRestock }}</span>
              <span>良品: {{ itemStats(row, item).good }}</span>
              <span>不良品: {{ itemStats(row, item).defective }}</span>
              <span>备用: {{ itemStats(row, item).spare }}</span>
              <span>直接销毁: {{ itemStats(row, item).destroy }}</span>
            </div>
          </div>
          <span v-if="!row.items?.length" class="muted">—</span>
        </template>
      </el-table-column>

      <el-table-column label="退件说明" min-width="180">
        <template #default="{ row }">
          <div class="desc-block">
            <div><span class="lbl">退件原因</span>{{ row.returnReason || '—' }}</div>
            <div v-if="row.returnDescription"><span class="lbl">退件说明</span>{{ row.returnDescription }}</div>
            <div v-if="row.remark"><span class="lbl">备注</span>{{ row.remark }}</div>
            <div v-if="row.processRemark"><span class="lbl">处理备注</span>{{ row.processRemark }}</div>
            <div><span class="lbl">作业来源</span>OMS 预约</div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="退件费用" width="100" align="right">
        <template #default="{ row }">
          <span class="fee">{{ formatFee(row.estimatedFeeTotal) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="时间" min-width="190">
        <template #default="{ row }">
          <div class="time-block">
            <div><span class="lbl">创建时间</span>{{ formatTime(row.createdAt) }}</div>
            <div><span class="lbl">预计到货</span>{{ formatTime(row.expectedArrivalAt) }}</div>
            <div v-if="row.receivedAt"><span class="lbl">收货时间</span>{{ formatTime(row.receivedAt) }}</div>
            <div v-if="row.processedAt"><span class="lbl">处理时间</span>{{ formatTime(row.processedAt) }}</div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <div class="op-links">
            <button type="button" class="op-link" @click="openDetail(row)">查看</button>
            <button type="button" class="op-link" @click="openLog(row)">日志</button>
            <button
              v-if="row.status === 'pending_arrival' && app.hasPerm('return.receive')"
              type="button"
              class="op-link"
              @click="openReceive(row)"
            >收货清点</button>
            <button
              v-if="['received', 'arrived', 'measured', 'fee_calculated'].includes(row.status) && app.hasPerm('return.receive')"
              type="button"
              class="op-link"
              @click="openMeasure(row)"
            >测体积/算费</button>
            <button
              v-if="row.status === 'fee_calculated' && app.hasPerm('return.receive')"
              type="button"
              class="op-link"
              @click="openInspect(row)"
            >提交质检</button>
            <button
              v-if="row.status === 'dispose_pending' && app.hasPerm('return.process')"
              type="button"
              class="op-link warn"
              @click="handleDispose(row)"
            >确认销毁</button>
            <button
              v-if="row.status === 'accepted_pending' && app.hasPerm('return.process')"
              type="button"
              class="op-link success"
              @click="openProcess(row)"
            >完成处理</button>
            <button
              v-if="['arrived', 'processing'].includes(row.status) && app.hasPerm('return.process')"
              type="button"
              class="op-link success"
              @click="openProcess(row)"
            >完成处理</button>
            <template v-if="row.attachments?.length">
              <button
                v-for="att in row.attachments"
                :key="att.id"
                type="button"
                class="op-link"
                @click="downloadAttachment(row, att)"
              >下载附件</button>
            </template>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && !tableRows.length" description="暂无退件记录" />

    <ListPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="listTotal"
    />

    <el-dialog v-model="detailVisible" :title="'退件详情 · ' + (detailRow?.returnNo || '')" width="760px" class="erp-detail">
      <div v-loading="detailLoading">
        <template v-if="detailRow">
          <DetailSheet
            :kicker="detailRow.returnNo"
            :title="detailRow.orderNo || '退件'"
            :subtitle="[detailRow.omsCustomerCode, warehouseLabel(detailRow.returnWarehouse)].filter(Boolean).join(' · ')"
          >
            <template #status>
              <el-tag :type="statusTagType(detailRow.status)" size="small">
                {{ detailRow.statusLabel || STATUS_LABELS[detailRow.status] || detailRow.status }}
              </el-tag>
            </template>
            <template #metrics>
              <div class="erp-detail__metric">
                <label>总体积</label>
                <strong>{{ formatCbm(detailRow.totalVolumeCbm) }} CBM</strong>
              </div>
              <div class="erp-detail__metric">
                <label>计费重</label>
                <strong>{{ detailRow.totalChargeableWeightKg ?? '—' }} kg</strong>
              </div>
              <div class="erp-detail__metric is-accent">
                <label>预估费用</label>
                <strong>{{ formatFee(detailRow.estimatedFeeTotal) }}</strong>
              </div>
              <div class="erp-detail__metric">
                <label>实收 / 箱数</label>
                <strong>{{ detailRow.receivedQty ?? '—' }} / {{ detailRow.receivedCartonCount ?? '—' }}</strong>
              </div>
            </template>
          </DetailSheet>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="客户">{{ detailRow.omsCustomerCode || '—' }}</el-descriptions-item>
            <el-descriptions-item label="订单号">{{ detailRow.orderNo }}</el-descriptions-item>
            <el-descriptions-item label="退件仓库">{{ warehouseLabel(detailRow.returnWarehouse) }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTagType(detailRow.status)" size="small">
                {{ detailRow.statusLabel || STATUS_LABELS[detailRow.status] || detailRow.status }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="参考号">{{ detailRow.referenceNo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="跟踪号">{{ detailRow.trackingNo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="退件原因">{{ detailRow.returnReason }}</el-descriptions-item>
            <el-descriptions-item label="期望处理">{{ detailRow.requestedProcessLabel || detailRow.requestedProcess }}</el-descriptions-item>
            <el-descriptions-item label="处理结果">{{ detailRow.processResultLabel || detailRow.processResult || '—' }}</el-descriptions-item>
            <el-descriptions-item label="预计到货">{{ formatTime(detailRow.expectedArrivalAt) }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ formatTime(detailRow.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="收货时间">{{ formatTime(detailRow.receivedAt) }}</el-descriptions-item>
            <el-descriptions-item label="实收/箱数">{{ detailRow.receivedQty ?? '—' }} / {{ detailRow.receivedCartonCount ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="总体积">{{ formatCbm(detailRow.totalVolumeCbm) }} CBM</el-descriptions-item>
            <el-descriptions-item label="计费重">{{ detailRow.totalChargeableWeightKg ?? '—' }} kg</el-descriptions-item>
            <el-descriptions-item label="预估费用">{{ formatFee(detailRow.estimatedFeeTotal) }}</el-descriptions-item>
            <el-descriptions-item label="质检结论">{{ detailRow.inspectionResultLabel || '—' }}</el-descriptions-item>
            <el-descriptions-item label="客户决策">{{ detailRow.customerDecisionLabel || '—' }}</el-descriptions-item>
          </el-descriptions>
          <p v-if="detailRow.inspectionRemark" class="detail-note">质检说明：{{ detailRow.inspectionRemark }}</p>
          <el-divider v-if="detailRow.cartons?.length" content-position="left">外箱测量</el-divider>
          <el-table v-if="detailRow.cartons?.length" :data="detailRow.cartons" size="small" border class="mb-3">
            <el-table-column prop="cartonNo" label="箱号" width="60" />
            <el-table-column label="尺寸(cm)" min-width="140">
              <template #default="{ row: c }">{{ c.lengthCm }} × {{ c.widthCm }} × {{ c.heightCm }}</template>
            </el-table-column>
            <el-table-column prop="grossWeightKg" label="毛重kg" width="80" />
            <el-table-column prop="volumeCbm" label="CBM" width="90" />
            <el-table-column prop="chargeableWeightKg" label="计费重kg" width="90" />
          </el-table>
          <el-divider v-if="detailRow.feeLines?.length" content-position="left">费用明细（待入账）</el-divider>
          <el-table v-if="detailRow.feeLines?.length" :data="detailRow.feeLines" size="small" border class="mb-3">
            <el-table-column prop="description" label="项目" min-width="160" />
            <el-table-column prop="quantity" label="数量" width="70" />
            <el-table-column label="单价 (RMB)" width="100" align="right">
              <template #default="{ row }">{{ formatFee(row.unitPrice) }}</template>
            </el-table-column>
            <el-table-column label="金额 (RMB)" width="100" align="right">
              <template #default="{ row }">{{ formatFee(row.amount) }}</template>
            </el-table-column>
          </el-table>
          <el-divider v-if="detailRow.inspectionPhotos?.length" content-position="left">质检照片</el-divider>
          <div v-if="detailRow.inspectionPhotos?.length" class="att-list">
            <el-button
              v-for="att in detailRow.inspectionPhotos"
              :key="att.id"
              link
              type="primary"
              @click="downloadAttachment(detailRow, att)"
            >{{ att.fileName }}</el-button>
          </div>
          <el-divider content-position="left">OMS 上传附件</el-divider>
          <div v-if="detailRow.omsAttachments?.length || detailRow.attachments?.length" class="att-list">
            <el-button
              v-for="att in (detailRow.omsAttachments || detailRow.attachments)"
              :key="att.id"
              link
              type="primary"
              @click="downloadAttachment(detailRow, att)"
            >{{ att.fileName }}</el-button>
          </div>
          <el-empty v-else description="暂无附件" :image-size="48" />
          <el-divider content-position="left">SKU 明细</el-divider>
          <el-table :data="detailRow.items || []" size="small" border>
            <el-table-column prop="sku" label="SKU" width="140" />
            <el-table-column prop="productName" label="商品名" min-width="160" />
            <el-table-column prop="quantity" label="数量" width="80" align="right" />
          </el-table>
        </template>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="logVisible" :title="'操作日志 · ' + (logTarget?.returnNo || '')" width="680px">
      <el-table v-loading="logLoading" :data="logRows" size="small" border max-height="360">
        <el-table-column prop="createdAt" label="时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="140" />
        <el-table-column prop="operatorName" label="操作人" width="100" />
        <el-table-column prop="detail" label="详情" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail || '') }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!logLoading && !logRows.length" description="暂无日志" :image-size="48" />
      <template #footer>
        <el-button @click="logVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="receiveDialog" :title="'收货清点 · ' + (receiveTarget?.returnNo || '')" width="440px">
      <el-form label-width="90px">
        <el-form-item label="实收件数" required>
          <el-input v-model="receiveQty" type="number" min="1" />
        </el-form-item>
        <el-form-item label="实收箱数" required>
          <el-input v-model="receiveCartons" type="number" min="1" />
        </el-form-item>
        <el-form-item label="收货备注">
          <el-input v-model="receiveRemark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="receiveDialog = false">取消</el-button>
        <el-button type="primary" :loading="receiveSubmitting" @click="submitReceive">确认收货</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="measureDialog"
      :title="'测体积与费用 · ' + (measureTarget?.returnNo || '')"
      width="680px"
      class="measure-dialog"
    >
      <div v-if="measureTarget" class="measure-summary">
        <span>实收 <strong>{{ measureTarget.receivedQty ?? measureTarget.totalQty ?? '—' }}</strong> 件</span>
        <span>SKU <strong>{{ measureSkuQty }}</strong> 件</span>
        <span>共 <strong>{{ measureCartons.length }}</strong> 箱</span>
        <span>总体积 <strong>{{ formatCbm(previewVolume) }}</strong> CBM</span>
        <span>体积重 <strong>{{ previewChargeableWeight.toFixed(3) }}</strong> kg</span>
      </div>

      <div v-if="feePreview?.template" class="template-banner">
        收费模板：<strong>{{ feePreview.template.templateName }}</strong>
        <span class="template-code">({{ feePreview.template.templateCode }})</span>
      </div>

      <div class="carton-grid">
        <div v-for="(carton, index) in measureCartons" :key="index" class="carton-card">
          <div class="carton-card-head">
            <span class="carton-no">第 {{ index + 1 }} 箱</span>
            <el-button
              v-if="measureCartons.length > 1"
              link
              type="danger"
              size="small"
              @click="removeMeasureCarton(index)"
            >删除</el-button>
          </div>
          <div class="carton-fields">
            <label>
              <span>长 (cm)</span>
              <el-input v-model="carton.lengthCm" type="number" min="0" placeholder="长" />
            </label>
            <label>
              <span>宽 (cm)</span>
              <el-input v-model="carton.widthCm" type="number" min="0" placeholder="宽" />
            </label>
            <label>
              <span>高 (cm)</span>
              <el-input v-model="carton.heightCm" type="number" min="0" placeholder="高" />
            </label>
            <label>
              <span>毛重 (kg)</span>
              <el-input v-model="carton.grossWeightKg" type="number" min="0" placeholder="毛重" />
            </label>
          </div>
          <p v-if="previewCartons[index]?.valid" class="carton-meta">
            体积 {{ formatCbm(previewCartons[index]?.volumeCbm) }} CBM ·
            体积重 {{ previewCartons[index]?.volumetricWeightKg.toFixed(3) }} kg ·
            计费重 {{ previewCartons[index]?.chargeableWeightKg.toFixed(3) }} kg
          </p>
        </div>
      </div>

      <el-button size="small" class="add-carton-btn" @click="addMeasureCarton">+ 加一箱</el-button>

      <div v-loading="feePreviewLoading" class="fee-preview-panel">
        <div class="fee-preview-title">{{ measureFeeTitle }}</div>
        <el-table v-if="feePreview?.autoLines?.length" :data="feePreview.autoLines" size="small" border>
          <el-table-column prop="description" label="费用项目" min-width="180" />
          <el-table-column prop="quantity" label="数量" width="70" align="right" />
          <el-table-column label="单价 (RMB)" width="100" align="right">
            <template #default="{ row }">{{ formatFee(row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column label="金额 (RMB)" width="100" align="right">
            <template #default="{ row }">{{ formatFee(row.amount) }}</template>
          </el-table-column>
        </el-table>
        <p v-else class="fee-preview-empty">填写外箱尺寸后，系统按模板计算退件物流费</p>
        <div v-if="previewFeeTotal > 0" class="fee-preview-total">
          物流费合计：<strong>{{ formatFee(previewFeeTotal) }}</strong>
        </div>
        <p class="measure-hint">体积重 = 长×宽×高÷5000 (cm)；计费重取各箱 max(毛重, 体积重) 后合计。费用按该仓库收费模板中的规则计算。</p>
        <p class="measure-hint">检查拍照、直接上架、换标上架等处理费用，将在 OMS 客户确认留货并选择方式后另行计入。</p>
      </div>

      <template #footer>
        <el-button @click="measureDialog = false">取消</el-button>
        <el-button type="primary" :loading="measureSubmitting" :disabled="previewVolume <= 0" @click="submitMeasure">
          确认测量并生成物流费
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="inspectDialog" :title="'质检拍照 · ' + (inspectTarget?.returnNo || '')" width="560px">
      <el-form label-width="90px">
        <el-form-item label="质检结论" required>
          <el-select v-model="inspectResult" style="width: 100%">
            <el-option v-for="o in INSPECTION_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="质检说明">
          <el-input v-model="inspectRemark" type="textarea" :rows="3" placeholder="外观、破损、少件等说明" />
        </el-form-item>
        <el-form-item label="质检照片" required>
          <input ref="inspectFileRef" type="file" accept="image/*" multiple class="hidden-input" @change="(e: Event) => void onInspectFiles((e.target as HTMLInputElement).files)">
          <el-button size="small" @click="inspectFileRef?.click()">上传照片</el-button>
          <ul v-if="inspectPhotos.length" class="photo-list">
            <li v-for="p in inspectPhotos" :key="p.fileName">{{ p.fileName }}</li>
          </ul>
        </el-form-item>
      </el-form>
      <p class="measure-hint">提交后将推送至 OMS，客户确认留/不留及后续处理方式。</p>
      <template #footer>
        <el-button @click="inspectDialog = false">取消</el-button>
        <el-button type="primary" :loading="inspectSubmitting" @click="submitInspect">提交质检</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="templateDialogVisible" title="退件收费模板（每仓独立）" width="860px" @closed="cancelEditTemplate">
      <p class="measure-hint">每个退件仓库各维护一套收费模板；测体积算费仅读取该退件单对应仓库的模板规则。体积重 = 长×宽×高÷5000 (cm)。</p>
      <div v-if="app.hasPerm('return.receive') && missingWarehouses.length" class="template-create-bar">
        <span class="text-muted">未配置仓库：</span>
        <el-button
          v-for="w in missingWarehouses"
          :key="w.value"
          size="small"
          @click="startCreateTemplate(w.value)"
        >+ {{ w.label }}</el-button>
      </div>
      <div v-if="editingTemplateId === 'new' && editingTemplate" class="template-card template-card-new">
        <div class="template-card-head"><strong>新建 · {{ editingTemplate.warehouseCode }}</strong></div>
        <el-form label-width="88px" size="small" class="template-edit-form">
          <el-form-item label="模板名称">
            <el-input v-model="editingTemplate.templateName" style="max-width: 280px" />
          </el-form-item>
          <el-form-item label="适用仓库">
            <el-select v-model="editingTemplate.warehouseCode" disabled style="width: 160px">
              <el-option v-for="w in RETURN_WAREHOUSE_LIST" :key="w.value" :label="w.label" :value="w.value" />
            </el-select>
          </el-form-item>
        </el-form>
        <el-table :data="editingTemplate.rules" size="small" border class="template-rule-table">
          <el-table-column label="#" width="44">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column label="费用类型" width="120">
            <template #default="{ row }">
              <el-select v-model="row.chargeType" size="small">
                <el-option v-for="o in FEE_CHARGE_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="费用说明" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.description" size="small" placeholder="如 退件物流费" />
            </template>
          </el-table-column>
          <el-table-column label="计费方式" width="130">
            <template #default="{ row }">
              <el-select v-model="row.calcMode" size="small">
                <el-option v-for="o in FEE_CALC_MODE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="单价 (RMB)" width="100">
            <template #default="{ row }">
              <el-input v-model="row.unitPrice" size="small" type="number" min="0" />
            </template>
          </el-table-column>
          <el-table-column label="最低量" width="80">
            <template #default="{ row }">
              <el-input
                v-model="row.minQty"
                size="small"
                type="number"
                min="0"
                :placeholder="row.calcMode === 'per_cbm' ? 'CBM' : row.calcMode === 'per_chargeable_weight' ? 'kg' : '—'"
                :disabled="!['per_cbm', 'per_chargeable_weight'].includes(row.calcMode)"
              />
            </template>
          </el-table-column>
          <el-table-column label="" width="56">
            <template #default="{ $index }">
              <el-button link type="danger" size="small" @click="removeTemplateRule($index)">删</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button size="small" class="add-rule-btn" @click="addTemplateRule">+ 添加规则</el-button>
        <div class="template-edit-actions">
          <el-button size="small" @click="cancelEditTemplate">取消</el-button>
          <el-button size="small" type="primary" :loading="templateSaving" @click="saveTemplate">创建模板</el-button>
        </div>
      </div>
      <el-empty v-if="!feeTemplates.length && editingTemplateId !== 'new'" description="暂无收费模板，请为仓库创建" :image-size="48" />
      <div v-for="tpl in feeTemplates" :key="tpl.id" class="template-card">
        <div class="template-card-head">
          <strong>{{ tpl.templateName }}</strong>
          <el-tag size="small" type="info">{{ tpl.warehouseCode }}</el-tag>
          <span class="template-code">{{ tpl.templateCode }}</span>
          <div v-if="app.hasPerm('return.receive') && editingTemplateId !== tpl.id" class="template-actions">
            <el-button size="small" type="primary" link @click="startEditTemplate(tpl)">编辑</el-button>
            <el-button size="small" type="danger" link @click="deleteTemplate(tpl)">删除</el-button>
          </div>
        </div>

        <template v-if="editingTemplateId === tpl.id && editingTemplate">
          <el-form label-width="88px" size="small" class="template-edit-form">
            <el-form-item label="模板名称">
              <el-input v-model="editingTemplate.templateName" style="max-width: 280px" />
            </el-form-item>
            <el-form-item label="适用仓库">
              <el-select v-model="editingTemplate.warehouseCode" disabled style="width: 160px">
                <el-option v-for="w in RETURN_WAREHOUSE_LIST" :key="w.value" :label="w.label" :value="w.value" />
              </el-select>
            </el-form-item>
          </el-form>
          <el-table :data="editingTemplate.rules" size="small" border class="template-rule-table">
            <el-table-column label="#" width="44">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="费用类型" width="120">
              <template #default="{ row }">
                <el-select v-model="row.chargeType" size="small">
                  <el-option v-for="o in FEE_CHARGE_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="费用说明" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.description" size="small" placeholder="如 外箱测量费" />
              </template>
            </el-table-column>
            <el-table-column label="计费方式" width="130">
              <template #default="{ row }">
                <el-select v-model="row.calcMode" size="small">
                  <el-option v-for="o in FEE_CALC_MODE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="单价 (RMB)" width="100">
              <template #default="{ row }">
                <el-input v-model="row.unitPrice" size="small" type="number" min="0" />
              </template>
            </el-table-column>
            <el-table-column label="最低量" width="80">
              <template #default="{ row }">
                <el-input
                  v-model="row.minQty"
                  size="small"
                  type="number"
                  min="0"
                  :placeholder="row.calcMode === 'per_cbm' ? 'CBM' : row.calcMode === 'per_chargeable_weight' ? 'kg' : '—'"
                  :disabled="!['per_cbm', 'per_chargeable_weight'].includes(row.calcMode)"
                />
              </template>
            </el-table-column>
            <el-table-column label="" width="56">
              <template #default="{ $index }">
                <el-button link type="danger" size="small" @click="removeTemplateRule($index)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p v-if="editingTemplate.rules[0]" class="measure-hint">{{ calcModeHint(editingTemplate.rules[0].calcMode) }}</p>
          <el-button size="small" class="add-rule-btn" @click="addTemplateRule">+ 添加规则</el-button>
          <div class="template-edit-actions">
            <el-button size="small" @click="cancelEditTemplate">取消</el-button>
            <el-button size="small" type="primary" :loading="templateSaving" @click="saveTemplate">保存模板</el-button>
          </div>
        </template>

        <template v-else>
          <p class="template-scope">适用仓库：{{ tpl.warehouseCode || '—' }}</p>
          <el-table :data="tpl.rules || []" size="small" border>
            <el-table-column prop="description" label="费用项目" min-width="160" />
            <el-table-column label="计费方式" width="120">
              <template #default="{ row }">{{ calcModeLabel(row.calcMode) }}</template>
            </el-table-column>
            <el-table-column label="单价 (RMB)" width="100" align="right">
              <template #default="{ row }">{{ formatFee(row.unitPrice) }}</template>
            </el-table-column>
            <el-table-column label="最低量" width="80" align="right">
              <template #default="{ row }">{{ row.minQty ?? '—' }}</template>
            </el-table-column>
          </el-table>
        </template>
      </div>
      <template #footer>
        <el-button @click="templateDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="processDialog" title="退件处理" width="480px">
      <el-form label-width="90px">
        <el-form-item label="退件单号">
          <span>{{ processTarget?.returnNo }}</span>
        </el-form-item>
        <el-form-item label="处理结果" required>
          <el-select v-model="processResultForm" style="width: 100%">
            <el-option v-for="o in PROCESS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理备注">
          <el-input v-model="processRemark" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="processDialog = false">取消</el-button>
        <el-button type="primary" @click="submitProcess">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.return-mgmt { padding: 16px 20px 24px; }
.page-header { margin-bottom: 14px; }
.page-title { font-size: 20px; font-weight: 600; margin: 0; }
.page-desc { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }

.filter-board {
  background: #fff;
  border: 1px solid #dbeafe;
  border-radius: 4px;
  padding: 12px 14px 14px;
  margin-bottom: 12px;
}
.filter-group {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px dashed #e2e8f0;
}
.filter-group:last-of-type { border-bottom: none; }
.filter-group-label {
  flex: 0 0 72px;
  font-size: 12px;
  color: #64748b;
  line-height: 28px;
  text-align: right;
}
.filter-tags { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
.filter-tag {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
  border-radius: 3px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.4;
}
.filter-tag:hover { border-color: #3b82f6; color: #2563eb; }
.filter-tag.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
  padding-top: 12px;
  margin-top: 4px;
  border-top: 1px solid #e2e8f0;
}
.search-item { display: flex; flex-direction: column; gap: 4px; }
.search-item label { font-size: 12px; color: #64748b; }
.search-item-wide { min-width: 340px; }
.code-search { display: flex; gap: 6px; align-items: center; }
.search-actions { display: flex; gap: 8px; margin-left: auto; padding-bottom: 1px; }

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.toolbar-left, .toolbar-right { display: flex; gap: 8px; }

.return-table :deep(.el-table__cell) { vertical-align: top; }
.no-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.row-no { font-size: 11px; color: #94a3b8; }

.info-block, .desc-block, .time-block { font-size: 12px; line-height: 1.65; color: #334155; }
.info-block > div, .desc-block > div, .time-block > div { margin-bottom: 2px; }
.lbl { color: #64748b; margin-right: 6px; }
.mono { font-family: var(--font-mono, Consolas, monospace); }
.link { color: #2563eb; cursor: pointer; }
.link:hover { text-decoration: underline; }

.item-block {
  padding: 6px 0;
  border-bottom: 1px dashed #e2e8f0;
  font-size: 12px;
  line-height: 1.55;
}
.item-block:last-child { border-bottom: none; padding-bottom: 0; }
.item-sku { font-weight: 600; color: #1e293b; margin-bottom: 2px; }
.item-line { color: #475569; }
.item-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: #64748b;
  font-size: 11px;
}
.fee { font-family: var(--font-mono, Consolas, monospace); color: #475569; }
.muted { color: #94a3b8; font-size: 12px; }

.op-links { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.op-link {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: #2563eb;
  cursor: pointer;
  text-align: left;
}
.op-link:hover { text-decoration: underline; }
.op-link.success { color: #16a34a; }
.op-link.warn { color: #d97706; }
.muted-op { font-size: 12px; color: #94a3b8; cursor: not-allowed; border: none; background: none; padding: 0; }
.measure-hint { font-size: 12px; color: #64748b; margin: 8px 0 0; }
.measure-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 13px;
  color: #475569;
}
.measure-summary strong { color: #1e293b; }
.carton-grid { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow-y: auto; }
.carton-card {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px 12px;
  background: #fff;
}
.carton-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.carton-no { font-size: 13px; font-weight: 600; color: #334155; }
.carton-fields {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.carton-fields label { display: flex; flex-direction: column; gap: 4px; }
.carton-fields label span { font-size: 11px; color: #64748b; }
.carton-meta { margin: 8px 0 0; font-size: 12px; color: #64748b; }
.add-carton-btn { margin-top: 10px; }
.fee-preview-panel {
  margin-top: 14px;
  padding: 12px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
}
.fee-preview-title { font-size: 13px; font-weight: 600; color: #0c4a6e; margin-bottom: 8px; }
.fee-preview-empty { font-size: 12px; color: #64748b; margin: 0; }
.fee-preview-total { margin-top: 8px; font-size: 14px; color: #0f172a; text-align: right; }
.fee-split { margin-left: 8px; font-size: 12px; color: #64748b; }
.template-banner {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 13px;
  color: #1e40af;
}
.template-code { margin-left: 6px; font-size: 12px; color: #64748b; }
.extra-fee-section { margin-top: 14px; padding-top: 12px; border-top: 1px dashed #bae6fd; }
.extra-fee-row {
  display: grid;
  grid-template-columns: 1fr 120px 56px;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.template-card {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
}
.template-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.template-actions { margin-left: auto; display: flex; gap: 4px; }
.template-create-bar { margin-bottom: 12px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.template-card-new { border-color: #7dd3fc; background: #f0f9ff; }
.template-edit-form { margin-bottom: 10px; }
.template-rule-table { margin-bottom: 8px; }
.template-edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.add-rule-btn { margin-top: 4px; }
.template-scope { font-size: 12px; color: #64748b; margin: 0 0 8px; }
.detail-note { font-size: 12px; color: #64748b; margin: 8px 0 0; }
.hidden-input { display: none; }
.photo-list { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: #475569; }
.mb-3 { margin-bottom: 12px; }

.att-list { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
</style>
