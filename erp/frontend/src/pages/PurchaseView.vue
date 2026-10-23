<script setup lang="ts">
import { userFacingError } from '@erp/shared/user-facing-error'
import { displaySku, displaySkuText } from '@erp/shared/sku-display'
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { erpConfirm, erpPrompt } from '@/utils/messageBox'
import { purchaseApi, supplierApi, productDevApi, warehouseApi, productApi } from '@/api/client.js'
import { mapPurchaseOrder, mapPrePurchaseOrder, mapProductDev } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { pickFile } from '@/composables/useAsyncIo'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'
import {
  PIPELINE_PURCHASE_ASSIGN,
  PIPELINE_PRE_PO,
  PIPELINE_PURCHASE_ORDERS,
} from '@/constants/productPipeline.ts'
import { productDevImageSrc } from '@/utils/productDevImage.ts'
import { downloadPurchaseOrderImportTemplate } from '@/constants/importTemplates.ts'
import { normalizeImportFileText } from '@/utils/csv'
import { showImportResultFeedback } from '@/utils/importResultFeedback.ts'

const app = useAppStore()
const router = useRouter()
const route = useRoute()

const mainTab = ref('orders')
const searchQ = ref(typeof route.query.poNo === 'string' ? route.query.poNo : '')
const poStatusFilter = ref('active')

const canCreate = computed(() => app.hasPerm('purchase.create'))
const canAssignPurchaser = computed(() => app.hasPerm('purchase.assign'))
const canPoAudit = computed(() => app.hasPerm('purchase.po_audit'))
const canMarkPaid = computed(() => app.hasPerm('purchase.mark_paid'))
const canSetActualQty = computed(() => app.hasPerm('product_audit.purchase_qty') || app.hasPerm('product_audit.approve'))

const { loading, items: poItems, load } = useListLoader(async () => {
  const res = await purchaseApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(mapPurchaseOrder), total: res.total }
})

const assignLoading = ref(false)
const assignItems = ref<any[]>([])
const assignSearchQ = ref('')
const prePoLoading = ref(false)
const prePoItems = ref<any[]>([])
const prePoMySearchQ = ref('')
const prePoStatusFilter = ref('assigned')
const assignError = ref('')
const prePoError = ref('')
const prePoActionId = ref<number | null>(null)
let assignLoadVersion = 0
let prePoLoadVersion = 0

async function loadPrePoPendingAssign() {
  const version = ++assignLoadVersion
  assignLoading.value = true
  assignError.value = ''
  try {
    const res = await purchaseApi.listPrePoPendingAssign({ pageSize: 200, keyword: assignSearchQ.value.trim() || undefined })
    if (version !== assignLoadVersion) return
    assignItems.value = (res.items || []).map(mapPrePurchaseOrder)
  } catch (error) {
    if (version !== assignLoadVersion) return
    assignError.value = `预采购分配加载失败，当前列表可能不是最新结果。${userFacingError(error)}`
  } finally {
    if (version === assignLoadVersion) assignLoading.value = false
  }
}

async function loadMyPrePo() {
  const version = ++prePoLoadVersion
  prePoLoading.value = true
  prePoError.value = ''
  try {
    const res = await purchaseApi.listMyPrePo({ pageSize: 200, status: prePoStatusFilter.value, keyword: prePoMySearchQ.value.trim() || undefined })
    if (version !== prePoLoadVersion) return
    prePoItems.value = (res.items || []).map(mapPrePurchaseOrder)
  } catch (error) {
    if (version !== prePoLoadVersion) return
    prePoError.value = `预采购单加载失败，当前列表可能不是最新结果。${userFacingError(error)}`
  } finally {
    if (version === prePoLoadVersion) prePoLoading.value = false
  }
}

onMounted(() => {
  load()
  if (canCreate.value) loadMyPrePo()
  if (canAssignPurchaser.value) loadPrePoPendingAssign()
})

const tabs = computed(() => {
  const list = [{ id: 'orders', label: '采购订单' }]
  if (canAssignPurchaser.value) {
    list.push({
      id: 'pre_assign',
      label: assignItems.value.length ? `预采购分配 (${assignItems.value.length})` : '预采购分配',
    })
  }
  if (canCreate.value) {
    list.push({
      id: 'pre_po',
      label: prePoItems.value.some(row => row.statusKey === 'assigned' || row.statusKey === 'returned') ? `预采购单 (${prePoItems.value.filter(row => row.statusKey === 'assigned' || row.statusKey === 'returned').length})` : '预采购单',
    })
  }
  if (canSetActualQty.value) {
    list.push({ id: 'actual_qty', label: '核定实际数量' })
  }
  list.push({ id: 'po_pending', label: '采购审核' }, { id: 'payment', label: '打款标记' })
  return list
})

function canShowPayment(statusKey?: string) {
  return ['finance_approved', 'at_logistics_wh', 'received', 'completed', 'approved'].includes(String(statusKey || ''))
}

function poTone(statusKey: string) {
  if (['finance_approved', 'at_logistics_wh', 'received', 'completed'].includes(statusKey)) return 'ok'
  if (statusKey === 'rejected') return 'danger'
  if (statusKey === 'voided') return 'info'
  if (statusKey === 'pending_po_audit' || statusKey === 'pending_actual_qty') return 'warn'
  return 'info'
}

/** 待核定实际数量时 quantity/amount 为 0，按核定数量×单价展示预估金额 */
function lineDisplayAmount(row: any, statusKey?: string) {
  const unitPrice = Number(row.unitPrice) || 0
  const qty = Number(row.quantity) || 0
  if (qty > 0) return Number(row.amount) || qty * unitPrice
  if (statusKey === 'pending_actual_qty' && row.plannedQty) {
    return Number(row.plannedQty) * unitPrice
  }
  return Number(row.amount) || 0
}

function poDisplayAmount(po: any) {
  if (!po?.items?.length) return Number(po?.amount) || 0
  if (po.statusKey === 'pending_actual_qty') {
    return po.items.reduce((sum: number, row: any) => sum + lineDisplayAmount(row, po.statusKey), 0)
  }
  return Number(po.amount) || 0
}

function fmtMoney(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function poSkuLabel(items: any[] | undefined) {
  if (!items?.length) return '—'
  return items.length === 1 ? items[0].sku : `${items[0].sku} 等 ${items.length}`
}

function poProductNameLabel(items: any[] | undefined) {
  if (!items?.length) return '—'
  return items.length === 1 ? (items[0].productName || '—') : `${items[0].productName || '—'} 等 ${items.length} SKU`
}

const poList = computed(() => {
  let list = poItems.value
  if (mainTab.value === 'orders' && poStatusFilter.value === 'active') list = list.filter(p => p.statusKey !== 'voided')
  if (mainTab.value === 'orders' && poStatusFilter.value !== 'active' && poStatusFilter.value !== 'all') {
    list = list.filter(p => p.statusKey === poStatusFilter.value)
  }
  if (mainTab.value === 'po_pending') list = list.filter(p => p.statusKey === 'pending_po_audit')
  if (mainTab.value === 'payment') list = list.filter(p => canShowPayment(p.statusKey))
  if (mainTab.value === 'actual_qty') list = list.filter(p => p.statusKey === 'pending_actual_qty')
  if (searchQ.value) {
    const q = searchQ.value.toLowerCase()
    list = list.filter(p =>
      p.poNo.toLowerCase().includes(q)
      || p.supplier.toLowerCase().includes(q)
      || p.items?.some((i: any) => i.sku?.toLowerCase().includes(q) || i.productName?.toLowerCase().includes(q)),
    )
  }
  return list.map(p => ({
    ...p,
    skuCount: p.items?.length || 0,
    skuLabel: poSkuLabel(p.items),
    productNameLabel: poProductNameLabel(p.items),
    amountFmt: fmtMoney(poDisplayAmount(p)),
    tone: poTone(p.statusKey),
  }))
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(poList)
watch([mainTab, searchQ, poStatusFilter], resetPage)

watch(mainTab, (tab) => {
  if (tab === 'pre_assign') loadPrePoPendingAssign()
  if (tab === 'pre_po') loadMyPrePo()
})

const prePoFiltered = computed(() => {
  const q = prePoMySearchQ.value.trim().toLowerCase()
  const rows = prePoItems.value.filter((row) => {
    if (prePoStatusFilter.value === 'all') return true
    if (prePoStatusFilter.value === 'assigned') return row.statusKey === 'assigned' || row.statusKey === 'returned'
    return row.statusKey === prePoStatusFilter.value
  })
  if (!q) return rows
  return rows.filter((r) =>
    r.sku.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q) || r.prePoNo.toLowerCase().includes(q),
  )
})

const {
  page: prePoPage,
  pageSize: prePoPageSize,
  total: prePoTotal,
  pagedItems: prePoPagedItems,
  resetPage: resetPrePoPage,
} = useTablePagination(prePoFiltered)

watch([mainTab, prePoMySearchQ, prePoStatusFilter], () => {
  if (mainTab.value === 'pre_po') resetPrePoPage()
})
watch(prePoStatusFilter, () => { if (mainTab.value === 'pre_po') void loadMyPrePo() })

const assignFiltered = computed(() => {
  const q = assignSearchQ.value.trim().toLowerCase()
  if (!q) return assignItems.value
  return assignItems.value.filter((r) =>
    r.prePoNo.toLowerCase().includes(q)
    || r.applyNo.toLowerCase().includes(q)
    || r.productName.toLowerCase().includes(q)
    || r.sku.toLowerCase().includes(q),
  )
})

const {
  page: assignPage,
  pageSize: assignPageSize,
  total: assignTotal,
  pagedItems: assignPagedItems,
  resetPage: resetAssignPage,
} = useTablePagination(assignFiltered)

watch([mainTab, assignSearchQ], () => {
  if (mainTab.value === 'pre_assign') resetAssignPage()
})

const supplierOptions = ref<{ id: number; label: string }[]>([])
async function loadSupplierOptions() {
  try {
    const res = await supplierApi.list({ pageSize: 200 })
    supplierOptions.value = (res.items || []).map((s: any) => ({ id: s.id, label: s.supplierName || s.name }))
  } catch (error) {
    ElMessage.error(`供应商选项加载失败，可重新打开表单加载。${userFacingError(error)}`)
  }
}

type CreatePoLine = {
  productId: number | null
  sku: string
  productName: string
  quantity: number
  unitPrice: number
  remark: string
}

function emptyCreatePoForm() {
  return {
    supplierId: null as number | null,
    supplierName: '',
    warehouseCode: '',
    expectedArrival: '',
    domesticFreight: null as number | null,
    remark: '',
    lines: [] as CreatePoLine[],
  }
}

const createPoVisible = ref(false)
const createPoForm = ref(emptyCreatePoForm())
const createPoWarehouses = ref<any[]>([])

type CreatePoSkuOption = {
  value: string
  sku: string
  productId: number | null
  productName: string
  unitPrice: number
}

async function searchCreatePoSkus(keyword: string): Promise<CreatePoSkuOption[]> {
  const q = keyword.trim()
  if (q.length < 3) return []

  const res = await productApi.list({ keyword: q, pageSize: 30 })
  return (res.items || []).map((p: any) => ({
    value: p.sku,
    sku: p.sku,
    productId: p.id,
    productName: p.productName,
    unitPrice: p.costRmb != null ? Number(p.costRmb) : 0,
  }))
}

const createPoLineTotal = computed(() =>
  createPoForm.value.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0),
)

const createPoTotalQty = computed(() =>
  createPoForm.value.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
)

async function loadCreatePoResources() {
  if (!supplierOptions.value.length) await loadSupplierOptions()
  if (!createPoWarehouses.value.length) {
    try {
      const whRes = await warehouseApi.list({ type: 'logistics' })
      createPoWarehouses.value = whRes.items || whRes || []
    } catch {
      createPoWarehouses.value = []
    }
  }
}

async function importPurchaseOrders() {
  const file = await pickFile()
  if (!file) return
  try {
    const content = normalizeImportFileText(await file.text())
    const result = await purchaseApi.importCsv(content)
    await showImportResultFeedback(result)
    await Promise.all([load(), canAssignPurchaser.value ? loadPrePoPendingAssign() : Promise.resolve()])
    if (canAssignPurchaser.value) mainTab.value = 'pre_assign'
  } catch (error) {
    ElMessage.error(`采购单导入失败，请核对模板后重试。${userFacingError(error)}`)
  }
}

async function openCreatePo() {
  createPoForm.value = emptyCreatePoForm()
  createPoVisible.value = true
  await loadCreatePoResources()
  if (!createPoForm.value.warehouseCode && createPoWarehouses.value[0]) {
    createPoForm.value.warehouseCode = createPoWarehouses.value[0].warehouseCode || createPoWarehouses.value[0].code || ''
  }
}

function addCreatePoLine(seed?: Partial<CreatePoLine>) {
  createPoForm.value.lines.push({
    productId: seed?.productId ?? null,
    sku: seed?.sku || '',
    productName: seed?.productName || '',
    quantity: seed?.quantity ?? 1,
    unitPrice: seed?.unitPrice ?? 0,
    remark: seed?.remark || '',
  })
}

function applyCreatePoSkuToLine(row: any, item: CreatePoSkuOption) {
  row.sku = item.sku
  row.productName = item.productName
  row.productId = item.productId
  row.unitPrice = item.unitPrice
}

async function queryCreatePoLineSku(queryString: string, cb: (results: CreatePoSkuOption[]) => void) {
  const q = queryString.trim()
  if (q.length < 3) {
    cb([])
    return
  }
  try {
    cb(await searchCreatePoSkus(q))
  } catch {
    cb([])
  }
}

function onCreatePoLineSkuSelect(row: any, item: Record<string, any>) {
  applyCreatePoSkuToLine(row, item as CreatePoSkuOption)
}

async function onCreatePoLineSkuBlur(row: any) {
  const q = row.sku.trim()
  if (q.length < 3) return
  try {
    const items = await searchCreatePoSkus(q)
    const exact = items.find((i) => i.sku.toLowerCase() === q.toLowerCase())
    const matched = exact || (items.length === 1 ? items[0] : null)
    if (matched) applyCreatePoSkuToLine(row, matched)
  } catch {
    // ignore lookup errors on blur
  }
}

function removeCreatePoLine(idx: number) {
  createPoForm.value.lines.splice(idx, 1)
}

async function submitCreatePo() {
  const f = createPoForm.value
  if (!f.supplierName?.trim()) {
    ElMessage.warning('请选择供应商')
    return
  }
  if (!f.warehouseCode) {
    ElMessage.warning('请选择目标中转仓')
    return
  }
  const validLines = f.lines.filter((l) => l.sku.trim() && Number(l.quantity) > 0)
  if (!validLines.length) {
    ElMessage.warning('请添加至少一条有效明细')
    return
  }
  if (validLines.some((l) => Number(l.unitPrice) <= 0)) {
    ElMessage.warning('请填写有效的采购单价')
    return
  }
  const ok = await withAction(async () => {
    await purchaseApi.create({
      supplierId: f.supplierId,
      supplierName: f.supplierName,
      warehouseCode: f.warehouseCode,
      expectedArrival: f.expectedArrival || undefined,
      domesticFreight: f.domesticFreight ?? undefined,
      remark: f.remark || undefined,
      items: validLines.map((l) => ({
        productId: l.productId || 0,
        sku: l.sku.trim(),
        productName: l.productName,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        remark: l.remark || undefined,
      })),
    })
  }, '已提交到预采购分配，请分配采购员后再确认采购')
  if (ok) {
    createPoVisible.value = false
    await Promise.all([load(), canAssignPurchaser.value ? loadPrePoPendingAssign() : Promise.resolve()])
    if (canAssignPurchaser.value) mainTab.value = 'pre_assign'
  }
}

const prePoDialogVisible = ref(false)
const prePoResubmitPoId = ref<number | null>(null)
const prePoResubmitRemark = ref('')
const prePoResubmitPoNo = ref('')
const prePoDetailLoading = ref(false)
const prePoSaving = ref(false)
const prePoFeedback = ref('')
const prePoUncertain = ref(false)
const prePoTargetId = ref<number | null>(null)
const editingPrePo = ref<any>(null)
const prePoWarehouses = ref<any[]>([])

function prePoDisplayText(value?: string | null) {
  const text = String(value ?? '').trim()
  return text && text !== '—' ? text : ''
}

function prePoNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function prePoDate(value: unknown): string | undefined {
  if (!value) return undefined
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

function buildPrePoEditForm(detail: any) {
  return {
    id: detail.id,
    prePoNo: detail.prePoNo,
    sku: detail.sku || '',
    productName: detail.productName || '',
    spec: detail.spec || '',
    plannedQty: detail.plannedQty ?? 1,
    unitPrice: prePoNum(detail.unitPrice),
    supplierId: detail.supplierId ?? null,
    supplierName: prePoDisplayText(detail.supplierName) || prePoDisplayText(detail.supplier),
    supplierContactName: detail.supplierContactName || '',
    supplierContactPhone: detail.supplierContactPhone || '',
    supplierAddress: detail.supplierAddress || '',
    domesticFreight: prePoNum(detail.domesticFreight),
    warehouseCode: detail.warehouseCode || '',
    expectedArrival: prePoDate(detail.expectedArrival) || prePoDate(detail.expectedArrivalStr),
    productLink: detail.productLink || '',
    accessories: detail.accessories || '',
    moq: prePoNum(detail.moq),
    leadTimeDays: prePoNum(detail.leadTimeDays),
    taxRate: prePoNum(detail.taxRate),
    invoiceTaxRate: prePoNum(detail.invoiceTaxRate),
    unitTax: prePoNum(detail.unitTax),
    unitFreight: prePoNum(detail.unitFreight),
    productLengthCm: prePoNum(detail.productLengthCm),
    productWidthCm: prePoNum(detail.productWidthCm),
    productHeightCm: prePoNum(detail.productHeightCm),
    packageWeightKg: prePoNum(detail.packageWeightKg),
    packageLengthCm: prePoNum(detail.packageLengthCm),
    packageWidthCm: prePoNum(detail.packageWidthCm),
    packageHeightCm: prePoNum(detail.packageHeightCm),
    sampleStatus: detail.sampleStatus || '',
    samplePackageInfo: detail.samplePackageInfo || '',
    sampleImageUrl: detail.sampleImageUrl || '',
    doubleLayerCarton: detail.doubleLayerCarton ?? null,
    notPurchaseReason: detail.notPurchaseReason || '',
    logoUnitFee: prePoNum(detail.logoUnitFee),
    logoTotalFee: prePoNum(detail.logoTotalFee),
    cartonTotalPrice: prePoNum(detail.cartonTotalPrice),
    spareCartonUnitPrice: prePoNum(detail.spareCartonUnitPrice),
    spareCartonQty: prePoNum(detail.spareCartonQty),
    piecesPerCarton: prePoNum(detail.piecesPerCarton),
    productImageUrl: detail.productImageUrl || '',
    manualUrl: detail.manualUrl || '',
    remark: detail.remark || '',
  }
}

async function loadPrePoWarehouses() {
  if (prePoWarehouses.value.length) return
  try {
    const { warehouseApi } = await import('@/api/client.js')
    const whRes = await warehouseApi.list({ type: 'logistics' })
    prePoWarehouses.value = whRes.items || whRes || []
  } catch (error) {
    ElMessage.error(`收货仓库选项加载失败，可重新打开表单加载。${userFacingError(error)}`)
  }
}

async function openPrePoEdit(row: any, options?: { resubmitPoId?: number; remark?: string; poNo?: string }) {
  if (prePoSaving.value) return
  prePoResubmitPoId.value = options?.resubmitPoId ?? null
  prePoResubmitRemark.value = options?.remark || ''
  prePoResubmitPoNo.value = options?.poNo || ''
  prePoDialogVisible.value = true
  prePoTargetId.value = row.id
  prePoFeedback.value = ''
  prePoUncertain.value = false
  editingPrePo.value = null
  prePoDetailLoading.value = true
  try {
    const [detail] = await Promise.all([
      purchaseApi.prePoDetail(row.id),
      supplierOptions.value.length ? Promise.resolve() : loadSupplierOptions(),
      loadPrePoWarehouses(),
    ])
    if (prePoTargetId.value !== row.id || !prePoDialogVisible.value) return
    if (!['assigned', 'returned'].includes(detail.status)) throw new Error('该预采购单当前不能修改，请返回列表核对')
    if (!prePoResubmitRemark.value && detail.linkedPoAuditRemark) prePoResubmitRemark.value = detail.linkedPoAuditRemark
    if (!prePoResubmitPoNo.value && detail.linkedPoNo) prePoResubmitPoNo.value = detail.linkedPoNo
    editingPrePo.value = buildPrePoEditForm(detail)
  } catch (error) {
    if (prePoTargetId.value === row.id) prePoFeedback.value = `读取最新单据失败，未启用旧资料编辑。${userFacingError(error)}`
  } finally { if (prePoTargetId.value === row.id) prePoDetailLoading.value = false }
}

async function savePrePoEdit() {
  if (!editingPrePo.value || prePoSaving.value || prePoUncertain.value) return
  const f = editingPrePo.value
  const payload = {
    sku: f.sku,
    productName: f.productName,
    spec: f.spec,
    plannedQty: f.plannedQty,
    unitPrice: f.unitPrice,
    supplierId: f.supplierId,
    supplierName: f.supplierName,
    supplierContactName: f.supplierContactName,
    supplierContactPhone: f.supplierContactPhone,
    supplierAddress: f.supplierAddress,
    domesticFreight: f.domesticFreight !== '' ? f.domesticFreight : undefined,
    warehouseCode: f.warehouseCode || '',
    expectedArrival: f.expectedArrival || '',
    productLink: f.productLink,
    accessories: f.accessories,
    productImageUrl: f.productImageUrl,
    manualUrl: f.manualUrl,
    moq: f.moq,
    leadTimeDays: f.leadTimeDays,
    taxRate: f.taxRate,
    invoiceTaxRate: f.invoiceTaxRate,
    unitTax: f.unitTax,
    unitFreight: f.unitFreight,
    productLengthCm: f.productLengthCm,
    productWidthCm: f.productWidthCm,
    productHeightCm: f.productHeightCm,
    packageWeightKg: f.packageWeightKg,
    packageLengthCm: f.packageLengthCm,
    packageWidthCm: f.packageWidthCm,
    packageHeightCm: f.packageHeightCm,
    sampleStatus: f.sampleStatus,
    samplePackageInfo: f.samplePackageInfo,
    sampleImageUrl: f.sampleImageUrl,
    doubleLayerCarton: f.doubleLayerCarton,
    notPurchaseReason: f.notPurchaseReason,
    logoUnitFee: f.logoUnitFee,
    logoTotalFee: f.logoTotalFee,
    cartonTotalPrice: f.cartonTotalPrice,
    spareCartonUnitPrice: f.spareCartonUnitPrice,
    spareCartonQty: f.spareCartonQty,
    piecesPerCarton: f.piecesPerCarton,
    remark: f.remark,
  }
  prePoSaving.value = true
  prePoFeedback.value = ''
  try {
    if (prePoResubmitPoId.value) {
      await purchaseApi.resubmit(prePoResubmitPoId.value, payload)
      const poLabel = prePoResubmitPoNo.value ? `采购单 ${prePoResubmitPoNo.value}` : '采购单'
      ElMessage.success(`${poLabel}已重新提交，进入预采购分配`)
      prePoDialogVisible.value = false
      detailVisible.value = false
      await Promise.all([load(), loadMyPrePo(), canAssignPurchaser.value ? loadPrePoPendingAssign() : Promise.resolve()])
      if (canAssignPurchaser.value) mainTab.value = 'pre_assign'
    } else {
      await purchaseApi.updatePrePo(f.id, payload)
      ElMessage.success('预采购单已保存，可继续确认采购')
      prePoDialogVisible.value = false
      await loadMyPrePo()
    }
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status)
    prePoUncertain.value = !Number.isFinite(status) || status < 100 || status >= 500 || status === 408 || status === 409
    prePoFeedback.value = prePoUncertain.value
      ? `保存结果暂无法确认，请返回列表重新读取单据核对，请勿重复保存。${userFacingError(error)}`
      : userFacingError(error)
  } finally { prePoSaving.value = false }
}

function formatPrePoVolume(form: any, prefix: 'product' | 'package') {
  const suffixes = ['LengthCm', 'WidthCm', 'HeightCm']
  const values = suffixes.map((suffix) => Number(form?.[`${prefix}${suffix}`]))
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return '待填写长 × 宽 × 高'
  return `${(values[0] * values[1] * values[2] / 1_000_000).toFixed(6)} m³`
}

function formatConfirmationDimension(data: any, prefix: 'product' | 'package') {
  const values = [data?.[`${prefix}LengthCm`], data?.[`${prefix}WidthCm`], data?.[`${prefix}HeightCm`]]
  return values.every((value) => value != null) ? `${values.join(' × ')} cm` : '—'
}

function confirmationMoney(value: unknown) {
  return value != null ? `¥ ${Number(value).toFixed(2)}` : '—'
}

function financeQty(line: any) {
  return Number(line?.quantity) > 0 ? Number(line.quantity) : Number(line?.plannedQty) || 0
}

function financeLineBreakdown(line: any, confirmation: any) {
  const qty = financeQty(line)
  const goods = Number(line?.amount) > 0 ? Number(line.amount) : qty * (Number(line?.unitPrice) || 0)
  const domesticFreight = Number(line?.domesticFreight) || 0
  const tax = qty * (Number(confirmation?.unitTax) || 0)
  return { qty, goods, domesticFreight, tax, total: goods + domesticFreight + tax }
}

function financeSummary(po: any) {
  const confirmation = po?.purchaseConfirmation
  const lineTotals = (po?.items || []).reduce((sum: any, line: any) => {
    const part = financeLineBreakdown(line, confirmation)
    sum.goods += part.goods
    sum.domesticFreight += part.domesticFreight
    sum.tax += part.tax
    return sum
  }, { goods: 0, domesticFreight: 0, tax: 0 })
  const logo = Number(confirmation?.logoTotalFee) || 0
  const carton = Number(confirmation?.cartonTotalPrice) || 0
  const spareCarton = (Number(confirmation?.spareCartonUnitPrice) || 0) * (Number(confirmation?.spareCartonQty) || 0)
  return { ...lineTotals, logo, carton, spareCarton, total: lineTotals.goods + lineTotals.domesticFreight + lineTotals.tax + logo + carton + spareCarton }
}

async function cancelPrePoRow(row: any) {
  if (prePoActionId.value) return
  prePoActionId.value = row.id
  try {
    const { value } = await erpPrompt('请填写取消采购原因', '取消预采购', {
      confirmButtonText: '确认取消',
      cancelButtonText: '返回',
      inputPattern: /\S+/,
      inputErrorMessage: '原因不能为空',
      type: 'warning',
    })
    await purchaseApi.cancelPrePo(row.id, { reason: value })
    ElMessage.success('预采购已取消，取消原因已保存')
    prePoStatusFilter.value = 'cancelled'
    await loadMyPrePo()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') prePoError.value = userFacingError(error)
  } finally { prePoActionId.value = null }
}

async function confirmPrePoRow(row: any) {
  if (prePoActionId.value) return
  prePoActionId.value = row.id
  try {
    await erpConfirm(
      `确认预采购单 ${row.prePoNo}？${row.convertedPoId ? '将重新提交原采购单' : '将生成正式采购单'}，实际数量需产品主管核定。`,
      '确认采购',
      { type: 'info' },
    )
    const result = await purchaseApi.confirmPrePo(row.id)
    ElMessage.success(`采购单 ${result.poNo} 已提交，下一步由产品主管核定实际数量`)
    await Promise.all([loadMyPrePo(), load()])
    mainTab.value = canSetActualQty.value ? 'actual_qty' : 'orders'
    searchQ.value = result.poNo
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      const status = Number((error as { status?: unknown })?.status)
      prePoError.value = status >= 400 && status < 500 && status !== 408 && status !== 409
        ? userFacingError(error)
        : `确认结果暂无法确定，请刷新预采购单及采购订单核对。${userFacingError(error)}`
    }
  } finally { prePoActionId.value = null }
}

async function submitActualQty(po: any) {
  if (!canOperatePo.value) return
  const line = po.items?.[0]
  if (!line || po.items.length !== 1) { detailFeedback.value = '请联系管理员逐项核对该单的采购明细'; return }
  actualQtyInput.value = ''
  actualQtyVisible.value = true
}

async function saveActualQty() {
  if (!canOperatePo.value || !selectedPo.value) return
  if (!/^[1-9]\d*$/.test(actualQtyInput.value) || Number(actualQtyInput.value) > 2147483647) {
    detailFeedback.value = '实际采购数量须为 1 至 2147483647 的整数'
    return
  }
  const id = selectedPo.value.id
  if (await runPoAction(() => purchaseApi.setActualQty(id, { quantity: Number(actualQtyInput.value) }), '实际数量已提交，下一步由采购主管审核')) {
    actualQtyVisible.value = false
    mainTab.value = 'po_pending'
    await openDetail({ id })
  }
}

const assignDialogVisible = ref(false)
const assigningRow = ref<any>(null)
const assignDevDetail = ref<any>(null)
const assignDevLoading = ref(false)
const assignPurchaserId = ref<number | null>(null)
const assignSubmitting = ref(false)
const purchaserOptions = ref<{ id: number; label: string }[]>([])

function assignDisplayVal(v: unknown, suffix = '') {
  if (v === null || v === undefined || v === '' || v === 0) return '—'
  return `${v}${suffix}`
}

function formatAssignProductDim(row: any) {
  if (!row?.productLengthCm) return '—'
  return `${row.productLengthCm} × ${row.productWidthCm} × ${row.productHeightCm} cm`
}

function formatAssignPackageDim(row: any) {
  if (!row?.packageLengthCm) return '—'
  return `${row.packageLengthCm} × ${row.packageWidthCm} × ${row.packageHeightCm} cm`
}

function openAssignUrl(url?: string, label = '链接') {
  if (url?.trim()) window.open(url.trim(), '_blank')
  else ElMessage.info(`暂无${label}`)
}

const assignDevProfit = computed(() => {
  const row = assignDevDetail.value
  if (!row?.sellPriceRmb || !row?.cost) return null
  return Number(row.sellPriceRmb) - Number(row.cost)
})

const assignDevProfitRate = computed(() => {
  const row = assignDevDetail.value
  if (assignDevProfit.value == null || !row?.sellPriceRmb) return null
  return (assignDevProfit.value / Number(row.sellPriceRmb)) * 100
})

async function loadPurchaserOptions() {
  try {
    const res = await purchaseApi.listPurchasers()
    purchaserOptions.value = (res.items || []).map((u: any) => ({
      id: Number(u.id),
      label: u.label || u.realName || u.username,
    }))
  } catch {
    purchaserOptions.value = []
    ElMessage.warning('采购员列表加载失败，请确认账号有「分配采购员」权限')
  }
}

async function openAssignDialog(row: any) {
  assigningRow.value = row
  assignDevDetail.value = null
  assignPurchaserId.value = null
  assignDialogVisible.value = true
  assignDevLoading.value = true
  if (!purchaserOptions.value.length) loadPurchaserOptions()
  try {
    const detail = await productDevApi.detail(row.devId)
    assignDevDetail.value = {
      ...mapProductDev(detail),
      auditRemark: detail.auditRemark || '',
    }
  } catch {
    ElMessage.warning('选品详情加载失败，仅显示预采购摘要')
  } finally {
    assignDevLoading.value = false
  }
}

async function submitAssignPurchaser() {
  if (!assigningRow.value || assignSubmitting.value) return
  if (!assignPurchaserId.value) {
    ElMessage.warning('请选择采购员')
    return
  }
  const purchaser = purchaserOptions.value.find((p) => p.id === assignPurchaserId.value)
  assignSubmitting.value = true
  try {
  const ok = await withAction(async () => {
    await purchaseApi.assignPrePo(assigningRow.value.id, { purchaserId: assignPurchaserId.value })
    await Promise.all([loadPrePoPendingAssign(), loadMyPrePo()])
  }, `已分配给采购员 ${purchaser?.label || ''}`)
  if (ok) {
    assignDialogVisible.value = false
    assigningRow.value = null
    assignDevDetail.value = null
    assignPurchaserId.value = null
  }
  } finally { assignSubmitting.value = false }
}

const detailVisible = ref(false)
const detailLoading = ref(false)
const selectedPo = ref<any>(null)
const detailTargetId = ref<number | null>(null)
const detailFeedback = ref('')
const poActionBusy = ref(false)
const poActionUncertain = ref(false)
const actualQtyVisible = ref(false)
const actualQtyInput = ref('')
const canOperatePo = computed(() => Boolean(selectedPo.value) && !detailLoading.value && !poActionBusy.value && !poActionUncertain.value)
let detailReadVersion = 0
const auditWarehouseCode = ref('')
const auditWarehouses = ref<any[]>([])

async function loadAuditWarehouses() {
  if (auditWarehouses.value.length) return
  try {
    const result = await warehouseApi.list({ type: 'logistics' })
    auditWarehouses.value = result.items || result || []
  } catch (error) {
    auditWarehouses.value = []
    throw error
  }
}

const auditTimeline = computed(() => {
  if (!selectedPo.value) return []
  const p = selectedPo.value
  const steps: { time: string; role: string; action: string; detail: string; type: string }[] = []
  steps.push({
    time: p.createdAtStr,
    role: p.purchaserName,
    action: p.statusKey === 'pending_actual_qty' ? '确认预采购（待核定数量）' : '创建采购单',
    detail: p.statusKey === 'pending_actual_qty'
      ? `SKU ${p.items?.[0]?.sku || '—'}，计划 ${p.items?.[0]?.plannedQty ?? '—'}，待产品主管核定实际数量`
      : `共 ${p.items?.length || 0} 个 SKU，总额 ¥${p.amount.toLocaleString()}`,
    type: 'primary',
  })
  if (p.auditedAtStr) {
    const hasRejection = ['rejected', 'pending_actual_qty', 'pending_po_audit'].includes(p.statusKey) && Boolean(p.poAuditRemark)
    steps.push({
      time: p.auditedAtStr,
      role: p.auditorName,
      action: hasRejection ? '上次采购主管驳回' : '采购主管审核',
      detail: p.poAuditRemark || '—',
      type: hasRejection ? 'danger' : 'success',
    })
  }
  if (p.financeAtStr && p.statusKey === 'rejected' && p.financeRemark) {
    steps.push({
      time: p.financeAtStr,
      role: p.financeName,
      action: '财务驳回',
      detail: p.financeRemark,
      type: 'danger',
    })
  }
  if (p.paidAtStr) {
    steps.push({
      time: p.paidAtStr,
      role: p.paidByName,
      action: p.paymentStatus === 'paid' ? '已付清' : p.paymentStatus === 'partial' ? '登记部分付款' : '清除打款',
      detail: p.financeRemark || '—',
      type: p.paymentStatus === 'paid' ? 'success' : 'warning',
    })
  }
  return steps
})

async function openDetail(po: any) {
  if (poActionBusy.value) return
  const version = ++detailReadVersion
  detailVisible.value = true
  detailLoading.value = true
  detailTargetId.value = po.id
  selectedPo.value = null
  detailFeedback.value = ''
  auditWarehouseCode.value = ''
  try {
    const detail = await purchaseApi.detail(po.id)
    if (version !== detailReadVersion) return
    selectedPo.value = mapPurchaseOrder(detail)
    if (selectedPo.value.statusKey === 'pending_po_audit' && !selectedPo.value.warehouseCode) {
      await loadAuditWarehouses()
    }
    if (version === detailReadVersion) poActionUncertain.value = false
  } catch (error) {
    if (version !== detailReadVersion) return
    selectedPo.value = null
    detailFeedback.value = `采购单详情未能完整读取，请重新读取后操作。${userFacingError(error)}`
  } finally {
    if (version === detailReadVersion) detailLoading.value = false
  }
}

async function runPoAction(action: () => Promise<any>, success: string | ((result: any) => string)) {
  if (!canOperatePo.value) return false
  poActionBusy.value = true
  detailFeedback.value = ''
  try {
    const result = await action()
    selectedPo.value = mapPurchaseOrder({ ...result, purchaseConfirmation: result.purchaseConfirmation ?? selectedPo.value?.purchaseConfirmation })
    ElMessage.success(typeof success === 'function' ? success(result) : success)
    void load()
    return true
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status)
    poActionUncertain.value = !(status >= 400 && status < 500 && status !== 408 && status !== 409)
    detailFeedback.value = poActionUncertain.value
      ? `操作结果暂无法确定，请重新读取采购单核对状态后继续。${userFacingError(error)}`
      : userFacingError(error)
    return false
  } finally { poActionBusy.value = false }
}

function canReopenAudit(row?: { statusKey?: string; paymentStatus?: string } | null) {
  return canPoAudit.value && ['finance_approved', 'approved'].includes(String(row?.statusKey || '')) && row?.paymentStatus === 'unpaid'
}

function canEditPendingAudit(row?: { statusKey?: string } | null) {
  return (canCreate.value || canPoAudit.value) && row?.statusKey === 'pending_po_audit'
}

const reviseVisible = ref(false)
const reviseSaving = ref(false)
const reviseForm = ref<any>(null)

async function openRevisePending(po?: { id: number }) {
  const target = po || selectedPo.value
  if (!target) return
  if (po) await openDetail(po)
  if (selectedPo.value?.id !== target.id || selectedPo.value.statusKey !== 'pending_po_audit') return
  await loadCreatePoResources()
  const detail = selectedPo.value
  reviseForm.value = {
    id: detail.id,
    poNo: detail.poNo,
    supplierName: detail.supplier && detail.supplier !== '—' ? detail.supplier : '',
    warehouseCode: detail.warehouseCode || '',
    expectedArrival: toDateInput(detail.expectedArrivalStr),
    domesticFreight: detail.domesticFreight,
    remark: detail.remark || '',
    lines: (detail.items || []).map((line: any) => ({
      id: line.id,
      sku: line.sku || '',
      productName: line.productName || '',
      quantity: Number(line.quantity) > 0 ? Number(line.quantity) : Number(line.plannedQty) || 1,
      unitPrice: Number(line.unitPrice) || 0,
    })),
  }
  reviseVisible.value = true
}

async function submitRevisePending() {
  const form = reviseForm.value
  if (!form || reviseSaving.value) return
  if (!form.supplierName?.trim()) { ElMessage.warning('请选择供应商'); return }
  if (!form.warehouseCode) { ElMessage.warning('请选择目标中转仓'); return }
  if (!form.lines.length || form.lines.some((line: any) => !line.sku?.trim() || !line.productName?.trim() || !(Number(line.quantity) >= 1) || !(Number(line.unitPrice) > 0))) {
    ElMessage.warning('请填写完整的 SKU、商品名称、数量和单价')
    return
  }
  reviseSaving.value = true
  try {
    const result = mapPurchaseOrder(await purchaseApi.revisePending(form.id, {
      supplierName: form.supplierName.trim(),
      warehouseCode: form.warehouseCode,
      expectedArrival: form.expectedArrival || '',
      domesticFreight: form.domesticFreight ?? undefined,
      remark: form.remark || '',
      items: form.lines.map((line: any) => ({
        id: line.id,
        sku: line.sku.trim(),
        productName: line.productName.trim(),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      })),
    }))
    selectedPo.value = result
    reviseVisible.value = false
    ElMessage.success(`采购单 ${form.poNo} 已修改，请重新审核`)
    mainTab.value = 'po_pending'
    void load()
  } catch (error) {
    ElMessage.error(userFacingError(error))
  } finally {
    reviseSaving.value = false
  }
}

async function reopenPoAudit(po?: { id: number }) {
  const target = po || selectedPo.value
  if (!target || poActionBusy.value) return
  try {
    await erpConfirm(
      '撤回后采购单回到待审核，本次审核写入的采购成本会清掉。尚未收货、未付款才能撤回。修改后需要再审一次。',
      '撤回到待审核',
      { type: 'warning', confirmButtonText: '撤回', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  if (po) await openDetail(po)
  if (selectedPo.value?.id !== target.id) return
  await runPoAction(async () => {
    const result = await purchaseApi.reopenAudit(target.id, { remark: '撤回审核，退回待审核' })
    mainTab.value = 'po_pending'
    return result
  }, '已撤回到待审核，可修改后再次审核')
}

async function passPoAudit() {
  if (!canOperatePo.value) return
  const warehouseCode = selectedPo.value.warehouseCode || auditWarehouseCode.value
  if (!warehouseCode) {
    detailFeedback.value = '请先选择目标中转仓'
    return
  }
  await runPoAction(async () => {
    const result = await purchaseApi.approve(selectedPo.value.id, { remark: '审核通过', warehouseCode })
    if (result?.status === 'draft') {
      detailVisible.value = false
      if (canAssignPurchaser.value) {
        mainTab.value = 'pre_assign'
        await loadPrePoPendingAssign()
      }
    }
    return result
  }, (result) => result?.status === 'draft'
    ? '审核已通过，已转入预采购分配'
    : '采购审核已通过，已同步主数据，下一步安排中转仓收货；默认未打款')
}

async function rejectPoAudit() {
  if (!canOperatePo.value) return
  try {
    const { value } = await erpPrompt('请填写驳回原因，将退回采购员修改', '采购主管驳回', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '驳回原因不能为空',
      type: 'warning',
    })
    const ok = await runPoAction(() => purchaseApi.rejectPoAudit(selectedPo.value.id, { remark: value }), '采购单已驳回。请修改后重新提交，进入分配采购员')
    if (ok) {
      void loadMyPrePo()
    }
  } catch (error) { if (error !== 'cancel' && error !== 'close') detailFeedback.value = userFacingError(error) }
}

function canVoidPo(row?: { statusKey?: string } | null) {
  return !!row && (row.statusKey === 'rejected' || row.statusKey === 'draft')
}

const voidingPoId = ref<number | null>(null)

async function voidPurchaseOrder(row: any) {
  if (voidingPoId.value || poActionBusy.value) return
  try {
    await erpConfirm(
      `标为废订单后不再进入审核和分配，单据仍可在「废订单」筛选中查看。确认把采购单 ${row.poNo || ''} 标为废订单？`,
      '标为废订单',
      { type: 'warning', confirmButtonText: '标为废订单', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  voidingPoId.value = row.id
  const ok = await withAction(async () => {
    await purchaseApi.voidOrder(row.id)
  }, '已标为废订单')
  voidingPoId.value = null
  if (!ok) return
  if (selectedPo.value?.id === row.id) {
    selectedPo.value = { ...selectedPo.value, statusKey: 'voided', status: '废订单' }
  }
  await Promise.all([load(), loadMyPrePo(), canAssignPurchaser.value ? loadPrePoPendingAssign() : Promise.resolve()])
}

async function removeCancelledPrePo(row: any) {
  if (prePoActionId.value) return
  try {
    await erpConfirm(
      `删除后不可恢复。确认删除已取消的预采购单 ${row.prePoNo || ''}？`,
      '删除预采购单',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  prePoActionId.value = row.id
  try {
    await purchaseApi.removePrePo(row.id)
    ElMessage.success('预采购单已删除')
    await loadMyPrePo()
  } catch (error) {
    prePoError.value = userFacingError(error)
  } finally {
    prePoActionId.value = null
  }
}

function canReviseRejected(row?: { statusKey?: string; prePoStatus?: string } | null) {
  if (row?.statusKey !== 'rejected') return false
  return row.prePoStatus !== 'pending_assign' && row.prePoStatus !== 'confirmed'
}

function openRejectedRevision(source: { poId?: number | null; prePoId?: number | null; poNo?: string; poAuditRemark?: string; items?: any[]; supplier?: string; warehouseCode?: string; expectedArrivalStr?: string; domesticFreight?: number | null; remark?: string }) {
  if (!source.poId) return
  if (!source.prePoId) {
    void openDirectRejectedRevision(source)
    return
  }
  detailVisible.value = false
  void openPrePoEdit({ id: source.prePoId }, {
    resubmitPoId: source.poId,
    remark: source.poAuditRemark || '',
    poNo: source.poNo || '',
  })
}

const directReviseVisible = ref(false)
const directReviseSaving = ref(false)
const directReviseForm = ref<any>(null)

function toDateInput(value?: string) {
  const matched = String(value || '').match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/)
  if (!matched) return ''
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`
}

async function openDirectRejectedRevision(source: { poId?: number | null; poNo?: string; poAuditRemark?: string }) {
  if (!source.poId) return
  detailVisible.value = false
  directReviseVisible.value = true
  directReviseForm.value = null
  await loadCreatePoResources()
  try {
    const detail = mapPurchaseOrder(await purchaseApi.detail(source.poId))
    if (detail.prePoId) {
      directReviseVisible.value = false
      void openPrePoEdit({ id: detail.prePoId }, {
        resubmitPoId: source.poId,
        remark: detail.poAuditRemark || source.poAuditRemark || '',
        poNo: detail.poNo || source.poNo || '',
      })
      return
    }
    if ((detail.items || []).length > 1) {
      directReviseVisible.value = false
      ElMessage.warning('该采购单包含多项明细，请先保留一项后再退回分配采购员')
      return
    }
    const line = detail.items?.[0] || {}
    directReviseForm.value = {
      poId: source.poId,
      poNo: detail.poNo || source.poNo || '',
      poAuditRemark: detail.poAuditRemark || source.poAuditRemark || '',
      supplierName: detail.supplier && detail.supplier !== '—' ? detail.supplier : '',
      warehouseCode: detail.warehouseCode || '',
      expectedArrival: toDateInput(detail.expectedArrivalStr),
      domesticFreight: detail.domesticFreight,
      remark: detail.remark || '',
      sku: line.sku || '',
      productName: line.productName || '',
      quantity: Number(line.quantity) > 0 ? Number(line.quantity) : Number(line.plannedQty) || 1,
      unitPrice: Number(line.unitPrice) || 0,
    }
  } catch (error) {
    directReviseVisible.value = false
    ElMessage.error(`读取采购单失败，请刷新后重试。${userFacingError(error)}`)
  }
}

async function submitDirectRejectedRevision() {
  const form = directReviseForm.value
  if (!form || directReviseSaving.value) return
  if (!form.supplierName?.trim()) {
    ElMessage.warning('请选择供应商')
    return
  }
  if (!form.sku?.trim() || !form.productName?.trim()) {
    ElMessage.warning('请填写 SKU 和商品名称')
    return
  }
  if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 1) {
    ElMessage.warning('采购数量须为大于零的整数')
    return
  }
  if (!(Number(form.unitPrice) > 0)) {
    ElMessage.warning('请填写大于零的采购单价')
    return
  }
  directReviseSaving.value = true
  try {
    await purchaseApi.resubmit(form.poId, {
      supplierName: form.supplierName.trim(),
      warehouseCode: form.warehouseCode || '',
      expectedArrival: form.expectedArrival || '',
      domesticFreight: form.domesticFreight ?? undefined,
      remark: form.remark || '',
      sku: form.sku.trim(),
      productName: form.productName.trim(),
      plannedQty: Number(form.quantity),
      unitPrice: Number(form.unitPrice),
    })
    directReviseVisible.value = false
    ElMessage.success(`采购单 ${form.poNo} 已重新提交，进入预采购分配`)
    await Promise.all([load(), loadMyPrePo(), canAssignPurchaser.value ? loadPrePoPendingAssign() : Promise.resolve()])
    if (canAssignPurchaser.value) mainTab.value = 'pre_assign'
  } catch (error) {
    ElMessage.error(userFacingError(error))
  } finally {
    directReviseSaving.value = false
  }
}

async function reviseRejectedPo(row?: { id?: number; prePoId?: number | null; poNo?: string; poAuditRemark?: string }) {
  const po = row || selectedPo.value
  if (!po) return
  openRejectedRevision({
    poId: po.id,
    prePoId: po.prePoId,
    poNo: po.poNo,
    poAuditRemark: po.poAuditRemark,
  })
}

const paymentVisible = ref(false)
const paymentSaving = ref(false)
const paymentTargetId = ref<number | null>(null)
const paymentForm = ref({ paymentType: 'deposit', amount: undefined as number | undefined, remark: '' })
const paymentTypeOptions = [
  { value: 'deposit', label: '定金' },
  { value: 'balance', label: '尾款' },
  { value: 'full', label: '全款' },
  { value: 'other', label: '其他' },
]

function paymentRemaining(po?: { paymentStatus?: string; unpaidAmount?: number; amount?: number } | null) {
  if (!po || po.paymentStatus === 'paid') return 0
  if (po.paymentStatus === 'partial') return Number(po.unpaidAmount) || 0
  return Number(po.amount) || 0
}

async function openPaymentDialog(po?: { id: number }) {
  const target = po || selectedPo.value
  if (!target || poActionBusy.value) return
  if (po) await openDetail(po)
  if (selectedPo.value?.id !== target.id) return
  const remaining = paymentRemaining(selectedPo.value)
  paymentTargetId.value = target.id
  paymentForm.value = {
    paymentType: selectedPo.value?.paymentStatus === 'partial' ? 'balance' : 'deposit',
    amount: undefined,
    remark: '',
  }
  if (remaining > 0 && paymentForm.value.paymentType === 'full') paymentForm.value.amount = remaining
  paymentVisible.value = true
}

function onPaymentTypeChange(paymentType: string) {
  if (paymentType === 'full') paymentForm.value.amount = paymentRemaining(selectedPo.value)
}

async function submitPayment() {
  if (!paymentTargetId.value || paymentSaving.value) return
  const remaining = paymentRemaining(selectedPo.value)
  const amount = paymentForm.value.paymentType === 'full' ? remaining : Number(paymentForm.value.amount)
  if (!(amount > 0)) {
    ElMessage.warning('请填写付款金额')
    return
  }
  paymentSaving.value = true
  try {
    const result = mapPurchaseOrder(await purchaseApi.markPaid(paymentTargetId.value, {
      paymentType: paymentForm.value.paymentType,
      amount,
      remark: paymentForm.value.remark.trim(),
    }))
    selectedPo.value = result
    paymentVisible.value = false
    ElMessage.success(result.paymentStatus === 'paid' ? `已付清 ¥${fmtMoney(result.paidAmount || amount)}` : `已登记${paymentTypeOptions.find((item) => item.value === paymentForm.value.paymentType)?.label || '付款'} ¥${fmtMoney(amount)}`)
    void load()
  } catch (error) {
    ElMessage.error(userFacingError(error))
  } finally {
    paymentSaving.value = false
  }
}

async function markPoPaid(po?: { id: number }) {
  await openPaymentDialog(po)
}

async function markPoUnpaid(po?: { id: number }) {
  const target = po || selectedPo.value
  if (!target || poActionBusy.value) return
  if (po) await openDetail(po)
  if (selectedPo.value?.id !== target.id) return
  await runPoAction(() => purchaseApi.markUnpaid(target.id), '已清除打款记录')
}
</script>

<template>
  <div class="purchase-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span class="page-title">采购订单</span>
          <div class="header-actions">
            <el-input
              v-if="mainTab === 'pre_assign'"
              v-model="assignSearchQ"
              placeholder="搜索预采购单 / SKU"
              clearable
              style="width:220px"
              size="small"
              @keyup.enter="loadPrePoPendingAssign"
            />
            <el-input
              v-else-if="mainTab === 'pre_po'"
              v-model="prePoMySearchQ"
              placeholder="搜索预采购单 / SKU"
              clearable
              style="width:220px"
              size="small"
              @keyup.enter="loadMyPrePo"
            />
            <el-input v-else-if="mainTab === 'orders' || mainTab === 'po_pending' || mainTab === 'payment' || mainTab === 'actual_qty'" v-model="searchQ" placeholder="搜索单号 / SKU / 供应商" clearable style="width:200px" size="small" />
            <el-select v-if="mainTab === 'orders'" v-model="poStatusFilter" size="small" style="width:130px" aria-label="采购单状态">
              <el-option label="有效订单" value="active" />
              <el-option label="废订单" value="voided" />
              <el-option label="已驳回" value="rejected" />
              <el-option label="待主管审核" value="pending_po_audit" />
              <el-option label="待核定数量" value="pending_actual_qty" />
              <el-option label="全部状态" value="all" />
            </el-select>
            <template v-if="canCreate && mainTab === 'orders'">
              <el-button type="primary" size="small" @click="openCreatePo">+ 创建采购单</el-button>
              <el-button size="small" link type="primary" @click="downloadPurchaseOrderImportTemplate">下载模板</el-button>
              <el-button size="small" @click="importPurchaseOrders">批量导入</el-button>
            </template>
            <el-button v-if="mainTab === 'pre_assign'" size="small" :loading="assignLoading" @click="loadPrePoPendingAssign">刷新列表</el-button>
            <el-button v-if="mainTab === 'pre_po'" size="small" :loading="prePoLoading" @click="loadMyPrePo">刷新列表</el-button>
            <el-select v-if="mainTab === 'pre_po'" v-model="prePoStatusFilter" size="small" style="width:120px" aria-label="预采购处理状态">
              <el-option label="进行中" value="assigned" />
              <el-option label="已取消" value="cancelled" />
              <el-option label="已生成采购单" value="confirmed" />
              <el-option label="全部记录" value="all" />
            </el-select>
          </div>
        </div>
      </template>

      <el-tabs v-model="mainTab" type="card">
        <el-tab-pane v-for="tab in tabs" :key="tab.id" :label="tab.label" :name="tab.id" />
      </el-tabs>

      <div v-if="mainTab === 'pre_assign'" class="pending-skus-panel">
        <el-alert v-if="assignError" :title="assignError" type="warning" :closable="false" role="alert" show-icon style="margin-bottom:12px" />
        <div class="callout info">
          <div class="callout-title">预采购单分配（采购主管）</div>
          <div class="callout-body">{{ PIPELINE_PURCHASE_ASSIGN }}</div>
        </div>
        <el-table v-loading="assignLoading" :data="assignPagedItems" :empty-text="assignError ? '加载未完成，请刷新重试' : '暂无数据'" stripe border size="small">
          <el-table-column prop="prePoNo" label="预采购单号" width="130"><template #default="{ row }"><span class="mono">{{ row.prePoNo }}</span></template></el-table-column>
          <el-table-column prop="applyNo" label="选品单号" width="120" />
          <el-table-column prop="sku" label="SKU" width="110"><template #default="{ row }"><span class="mono">{{ displaySku(row) }}</span></template></el-table-column>
          <el-table-column prop="productName" label="商品名称" min-width="140" show-overflow-tooltip />
          <el-table-column label="计划数量" width="90" align="right"><template #default="{ row }">{{ row.plannedQty }}</template></el-table-column>
          <el-table-column label="参考单价" width="90" align="right"><template #default="{ row }">{{ row.unitPrice != null ? `¥ ${row.unitPrice}` : '—' }}</template></el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canAssignPurchaser" link type="primary" size="small" @click="openAssignDialog(row)">分配采购员</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!assignLoading && !assignError && !assignFiltered.length" description="暂无待分配预采购单" />
        <ListPagination v-model:page="assignPage" v-model:page-size="assignPageSize" :total="assignTotal" />
      </div>

      <div v-else-if="mainTab === 'pre_po'" class="pending-skus-panel">
        <div class="callout info">
          <div class="callout-title">我的预采购单</div>
          <div class="callout-body">{{ PIPELINE_PRE_PO }}</div>
        </div>
        <el-alert v-if="prePoError" :title="prePoError" type="warning" :closable="false" role="alert" show-icon style="margin-bottom:12px" />
        <el-table v-loading="prePoLoading" :data="prePoPagedItems" :empty-text="prePoError ? '加载未完成，请刷新重试' : '暂无数据'" stripe border size="small">
          <el-table-column prop="prePoNo" label="预采购单号" width="130"><template #default="{ row }"><span class="mono">{{ row.prePoNo }}</span></template></el-table-column>
          <el-table-column prop="sku" label="SKU" width="110"><template #default="{ row }"><span class="mono">{{ displaySku(row) }}</span></template></el-table-column>
          <el-table-column prop="productName" label="商品名称" min-width="130" show-overflow-tooltip />
          <el-table-column prop="supplier" label="供应商" width="110" show-overflow-tooltip />
          <el-table-column label="单价" width="80" align="right"><template #default="{ row }">{{ row.unitPrice != null ? `¥ ${row.unitPrice}` : '—' }}</template></el-table-column>
          <el-table-column label="计划量" width="70" align="right"><template #default="{ row }">{{ row.plannedQty }}</template></el-table-column>
          <el-table-column label="状态" width="120"><template #default="{ row }">{{ ({ assigned: '进行中', returned: '退回待修改', cancelled: '已取消', confirmed: '已生成采购单', pending_assign: '待分配' } as Record<string, string>)[row.statusKey] || '待核对' }}</template></el-table-column>
          <el-table-column prop="cancelReason" label="取消原因" min-width="150" show-overflow-tooltip />
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <template v-if="row.statusKey === 'returned' || (row.statusKey === 'assigned' && row.linkedPoStatus === 'rejected')">
                <el-button link type="warning" size="small" :disabled="prePoActionId !== null" @click="openRejectedRevision({ poId: row.convertedPoId, prePoId: row.id, poNo: row.linkedPoNo, poAuditRemark: row.linkedPoAuditRemark })">修改重提</el-button>
              </template>
              <template v-else-if="row.statusKey === 'assigned'">
                <el-button link type="primary" size="small" :disabled="prePoActionId !== null" @click="openPrePoEdit(row)">编辑</el-button>
                <el-button link type="success" size="small" :disabled="prePoActionId !== null || prePoLoading" @click="confirmPrePoRow(row)">确认采购</el-button>
                <el-button link type="danger" size="small" :disabled="prePoActionId !== null || prePoLoading" @click="cancelPrePoRow(row)">取消</el-button>
              </template>
              <el-button v-else-if="row.statusKey === 'confirmed'" link type="primary" size="small" @click="mainTab = 'orders'; searchQ = row.sku; load()">查看关联采购</el-button>
              <el-button v-else-if="row.statusKey === 'cancelled'" link type="danger" size="small" :disabled="prePoActionId !== null" @click="removeCancelledPrePo(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!prePoLoading && !prePoError && !prePoFiltered.length" description="暂无预采购单" />
        <ListPagination v-model:page="prePoPage" v-model:page-size="prePoPageSize" :total="prePoTotal" />
      </div>

      <template v-else-if="mainTab === 'orders' || mainTab === 'po_pending' || mainTab === 'payment' || mainTab === 'actual_qty'">
      <el-alert v-if="mainTab === 'orders'" type="info" :closable="false" show-icon style="margin-bottom:12px">
      <p class="flow-hint">{{ PIPELINE_PURCHASE_ORDERS }}</p>
      <p v-if="canCreate" class="flow-hint">批量导入时，每条明细生成一张待分配预采购单。相同供应商、中转仓、到货、运费和备注会写在同一批预采购上，分配并确认后才生成正式采购单。</p>
      </el-alert>
      <el-alert v-if="mainTab === 'actual_qty'" type="warning" :closable="false" show-icon style="margin-bottom:12px">
        产品主管在此核定实际采购数量，提交后进入「采购审核」。
      </el-alert>
      <el-alert v-if="mainTab === 'payment'" type="info" :closable="false" show-icon style="margin-bottom:12px">
        采购审核通过的订单在此标记「已打款」或「未打款」。费用在审核通过时已写入成本台账，与打款状态无关。
      </el-alert>
      <el-table v-loading="loading" :data="pagedItems" stripe border style="width: 100%" size="small">
        <el-table-column prop="poNo" label="采购单号" width="150">
          <template #default="{ row }">
            <span style="font-family: var(--font-mono); font-size: 12px; color: #2563eb; cursor: pointer" @click="openDetail(row)">{{ row.poNo }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="skuLabel" label="SKU" width="110">
          <template #default="{ row }"><span class="mono">{{ displaySkuText(row.skuLabel) }}</span></template>
        </el-table-column>
        <el-table-column prop="productNameLabel" label="商品名称" min-width="130" show-overflow-tooltip />
        <el-table-column prop="supplier" label="供应商" min-width="130" />
        <el-table-column prop="warehouseName" label="目标中转仓" width="120" show-overflow-tooltip />
        <el-table-column prop="skuCount" label="SKU数" width="70" align="center" />
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">¥ {{ row.amountFmt }}</template>
        </el-table-column>
        <el-table-column prop="expectedArrivalStr" label="预计到货" width="100" />
        <el-table-column prop="purchaserName" label="采购员" width="90" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.tone === 'ok' ? 'success' : row.tone === 'warn' ? 'warning' : row.tone === 'danger' ? 'danger' : 'info'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="打款" width="150">
          <template #default="{ row }">
            <el-tag v-if="canShowPayment(row.statusKey)" :type="row.paymentStatus === 'paid' ? 'success' : row.paymentStatus === 'partial' ? 'warning' : 'info'" size="small">
              {{ row.paymentStatusLabel || '未打款' }}
            </el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAtStr" label="创建时间" width="110" />
        <el-table-column label="操作" :width="mainTab === 'payment' ? 140 : 320" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">
              {{ (canSetActualQty && row.statusKey === 'pending_actual_qty') ? '核定数量' : (canPoAudit && row.statusKey === 'pending_po_audit') ? '去审核' : '详情' }}
            </el-button>
            <el-button v-if="canEditPendingAudit(row)" link type="primary" size="small" @click="openRevisePending(row as any)">修改订单</el-button>
            <el-button v-if="canReopenAudit(row)" link type="warning" size="small" @click="reopenPoAudit(row as any)">撤回到待审核</el-button>
            <el-button v-if="canCreate && row.statusKey === 'rejected' && canReviseRejected(row)" link type="warning" size="small" @click="reviseRejectedPo(row)">修改重提</el-button>
            <span v-else-if="row.statusKey === 'rejected' && row.prePoStatus === 'pending_assign'">待分配</span>
            <el-button v-if="canCreate && canVoidPo(row)" link type="danger" size="small" :disabled="voidingPoId === row.id" @click="voidPurchaseOrder(row)">标为废订单</el-button>
            <template v-if="canMarkPaid && canShowPayment(row.statusKey)">
              <el-button v-if="row.paymentStatus !== 'paid'" link type="success" size="small" @click="markPoPaid(row as { id: number })">标记付款</el-button>
              <el-button v-if="row.paymentStatus !== 'unpaid'" link type="warning" size="small" @click="markPoUnpaid(row as { id: number })">清除打款</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
      </template>
    </el-card>
  </div>

  <el-drawer
    v-model="createPoVisible"
    title="创建采购单"
    size="960px"
    direction="rtl"
    class="create-po-drawer"
    destroy-on-close
  >
    <div class="create-po-body">
      <div class="callout info">
        <div class="callout-body">提交后进入「预采购分配」。采购主管分配采购员并确认后，才生成正式采购单，再核定数量并进入采购审核。</div>
      </div>

      <div class="form-section">
        <div class="section-title">基本信息</div>
        <el-form label-width="108px">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="供应商" required>
                <el-select v-model="createPoForm.supplierName" placeholder="选择或直接输入新供应商" filterable allow-create default-first-option style="width:100%">
                  <el-option v-for="s in supplierOptions" :key="s.id" :label="s.label" :value="s.label" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="目标中转仓" required>
                <el-select v-model="createPoForm.warehouseCode" placeholder="选择物流中转仓" filterable style="width:100%">
                  <el-option
                    v-for="w in createPoWarehouses"
                    :key="w.warehouseCode || w.code"
                    :label="w.warehouseName || w.name"
                    :value="w.warehouseCode || w.code"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="预计到货">
                <el-date-picker v-model="createPoForm.expectedArrival" type="date" value-format="YYYY-MM-DD" placeholder="可选" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="国内运费">
                <el-input-number v-model="createPoForm.domesticFreight" :min="0" :precision="2" controls-position="right" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="createPoForm.remark" type="textarea" :rows="2" placeholder="补货原因 / 备注" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <div class="form-section">
        <div class="section-head">
          <div class="section-title">采购明细</div>
          <el-button type="primary" size="small" @click="addCreatePoLine()">+ 添加行</el-button>
        </div>
        <el-table :data="createPoForm.lines" border size="small" class="lines-table" empty-text="点击「+ 添加行」开始录入">
          <el-table-column label="SKU" min-width="140">
            <template #default="{ row }">
              <el-autocomplete
                v-model="row.sku"
                :fetch-suggestions="queryCreatePoLineSku"
                placeholder="输入至少3字符"
                :trigger-on-focus="false"
                popper-class="create-po-sku-popper"
                style="width:100%"
                @select="(item: Record<string, unknown>) => onCreatePoLineSkuSelect(row, item)"
                @blur="onCreatePoLineSkuBlur(row)"
              >
                <template #default="{ item }: { item: CreatePoSkuOption }">
                  <div class="sku-suggest-item">
                    <span class="mono">{{ displaySku(item) }}</span>
                    <span class="sku-suggest-name">{{ item.productName }}</span>
                  </div>
                </template>
              </el-autocomplete>
            </template>
          </el-table-column>
          <el-table-column label="商品名称" min-width="150">
            <template #default="{ row }"><el-input v-model="row.productName" placeholder="商品名称" /></template>
          </el-table-column>
          <el-table-column label="采购数量" width="112" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" :min="1" :controls="false" class="line-num-input" />
            </template>
          </el-table-column>
          <el-table-column label="单价" width="112" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.unitPrice" :min="0" :precision="2" :controls="false" class="line-num-input" />
            </template>
          </el-table-column>
          <el-table-column label="小计" width="108" align="right">
            <template #default="{ row }"><span class="line-amt">¥ {{ fmtMoney((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0)) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="72" fixed="right">
            <template #default="{ $index }">
              <el-button link type="danger" size="small" @click="removeCreatePoLine($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="po-summary">
        <span>SKU 数：<strong>{{ createPoForm.lines.length }}</strong></span>
        <span>总数量：<strong>{{ createPoTotalQty.toLocaleString() }}</strong></span>
        <span>采购总额：<strong class="total-amt">¥ {{ fmtMoney(createPoLineTotal) }}</strong></span>
      </div>

      <div class="drawer-footer">
        <el-button @click="createPoVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreatePo">提交采购单</el-button>
      </div>
    </div>
  </el-drawer>

  <el-drawer v-model="detailVisible" :title="(selectedPo?.poNo || '') + ' · 采购单详情'" size="960px" direction="rtl" class="erp-detail" :close-on-click-modal="!poActionBusy" :close-on-press-escape="!poActionBusy" :show-close="!poActionBusy">
    <div v-loading="detailLoading" class="detail-body">
      <el-alert v-if="detailFeedback" :title="detailFeedback" type="warning" :closable="false" role="alert" style="margin-bottom:12px" />
      <el-button v-if="detailTargetId && !detailLoading" :disabled="poActionBusy" @click="openDetail({ id: detailTargetId })">重新读取采购单</el-button>
      <template v-if="selectedPo">
        <el-alert v-if="selectedPo.statusKey === 'voided'" title="该采购单已标为废订单，不再进入审核和分配。可在采购订单的「废订单」筛选中查看。" type="info" :closable="false" style="margin:12px 0" />
        <el-alert v-else-if="selectedPo.statusKey === 'rejected' && selectedPo.prePoStatus === 'pending_assign'" title="已重新提交，正在等待采购主管在「预采购分配」中分配采购员。分配并确认后仍沿用本采购单号。" type="info" :closable="false" style="margin:12px 0" />
        <el-alert v-else-if="selectedPo.statusKey === 'rejected'" :title="`驳回原因：${selectedPo.poAuditRemark || selectedPo.financeRemark || '请联系审核人核对'}。修改后重新提交将进入「预采购分配」，由采购主管重新分配采购员，仍沿用原采购单号。`" type="warning" :closable="false" style="margin:12px 0" />
        <DetailSheet
          :kicker="selectedPo.poNo"
          :title="selectedPo.supplier"
          :subtitle="[selectedPo.purchaserName, selectedPo.warehouseName, selectedPo.createdAtStr].filter(Boolean).join(' · ')"
        >
          <template #status>
            <el-tag :type="poTone(selectedPo.statusKey) === 'ok' ? 'success' : poTone(selectedPo.statusKey) === 'warn' ? 'warning' : poTone(selectedPo.statusKey) === 'danger' ? 'danger' : 'info'" size="small">{{ selectedPo.status }}</el-tag>
          </template>
          <template #metrics>
            <div class="erp-detail__metric is-accent">
              <label>采购总额</label>
              <strong>¥ {{ fmtMoney(poDisplayAmount(selectedPo)) }}</strong>
            </div>
            <div class="erp-detail__metric">
              <label>国内运费</label>
              <strong>{{ selectedPo.domesticFreight != null ? `¥ ${Number(selectedPo.domesticFreight).toFixed(2)}` : '—' }}</strong>
            </div>
            <div class="erp-detail__metric">
              <label>币种</label>
              <strong>{{ selectedPo.currency || '—' }}</strong>
            </div>
            <div class="erp-detail__metric">
              <label>预计到货</label>
              <strong>{{ selectedPo.expectedArrivalStr || '—' }}</strong>
            </div>
          </template>
        </DetailSheet>
        <el-descriptions :column="2" border size="small" title="基本信息">
          <el-descriptions-item label="采购单号"><span style="font-family:var(--font-mono)">{{ selectedPo.poNo }}</span></el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="poTone(selectedPo.statusKey) === 'ok' ? 'success' : poTone(selectedPo.statusKey) === 'warn' ? 'warning' : poTone(selectedPo.statusKey) === 'danger' ? 'danger' : 'info'" size="small">{{ selectedPo.status }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="供应商">{{ selectedPo.supplier }}</el-descriptions-item>
          <el-descriptions-item>
            <template #label>
              <span
                :class="{ 'desc-required-label': selectedPo.statusKey === 'pending_po_audit' && canPoAudit && !selectedPo.warehouseCode }"
              >目标中转仓</span>
            </template>
            <el-select
              v-if="selectedPo.statusKey === 'pending_po_audit' && canPoAudit && !selectedPo.warehouseCode"
              v-model="auditWarehouseCode"
              placeholder="请选择物流中转仓"
              aria-label="目标中转仓"
              filterable
              style="width: 220px"
            >
              <el-option
                v-for="warehouse in auditWarehouses"
                :key="warehouse.warehouseCode || warehouse.code"
                :label="warehouse.warehouseName || warehouse.name"
                :value="warehouse.warehouseCode || warehouse.code"
              />
            </el-select>
            <span v-else>{{ selectedPo.warehouseName }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="采购员">{{ selectedPo.purchaserName }}</el-descriptions-item>
          <el-descriptions-item label="币种">{{ selectedPo.currency }}</el-descriptions-item>
          <el-descriptions-item label="采购总额">
            <span class="erp-money">¥ {{ fmtMoney(poDisplayAmount(selectedPo)) }}</span>
            <span v-if="selectedPo.statusKey === 'pending_actual_qty'" class="form-tip">按核定数量×单价预估，提交实际数量后更新</span>
          </el-descriptions-item>
          <el-descriptions-item label="国内运费">
            {{ selectedPo.domesticFreight != null ? `¥ ${Number(selectedPo.domesticFreight).toFixed(2)}` : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="预计到货">{{ selectedPo.expectedArrivalStr || '—' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ selectedPo.createdAtStr }}</el-descriptions-item>
          <el-descriptions-item v-if="canShowPayment(selectedPo.statusKey)" label="打款状态">
            <el-tag :type="selectedPo.paymentStatus === 'paid' ? 'success' : selectedPo.paymentStatus === 'partial' ? 'warning' : 'info'" size="small">
              {{ selectedPo.paymentStatusLabel || '未打款' }}
            </el-tag>
            <span v-if="selectedPo.paymentStatus !== 'unpaid'" class="form-tip">
              已付 ¥{{ fmtMoney(selectedPo.paidAmount || 0) }}，待付 ¥{{ fmtMoney(selectedPo.unpaidAmount || 0) }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ selectedPo.remark || '—' }}</el-descriptions-item>
        </el-descriptions>

        <template v-if="canShowPayment(selectedPo.statusKey)">
          <div class="detail-section-title">付款记录</div>
          <el-table :data="selectedPo.payments || []" border size="small" style="margin-bottom:16px" empty-text="尚未登记付款">
            <el-table-column prop="paymentTypeLabel" label="类型" width="90" />
            <el-table-column label="金额" width="120" align="right"><template #default="{ row }">¥{{ fmtMoney(row.amount) }}</template></el-table-column>
            <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column prop="paidAtStr" label="时间" width="120" />
          </el-table>
          <div class="detail-section-title">费用明细</div>
          <el-descriptions :column="2" border size="small" title="单据信息">
            <el-descriptions-item label="采购单号"><span class="mono">{{ selectedPo.poNo }}</span></el-descriptions-item>
            <el-descriptions-item label="供应商">{{ selectedPo.supplier }}</el-descriptions-item>
            <el-descriptions-item label="采购员">{{ selectedPo.purchaserName }}</el-descriptions-item>
            <el-descriptions-item label="预计到货">{{ selectedPo.expectedArrivalStr || '—' }}</el-descriptions-item>
          </el-descriptions>

          <div class="detail-section-title">SKU 费用明细</div>
          <el-table :data="selectedPo.items || []" border size="small" style="margin-bottom:16px">
            <el-table-column prop="sku" label="SKU" width="130"><template #default="{ row }"><span class="mono">{{ displaySku(row) }}</span></template></el-table-column>
            <el-table-column prop="productName" label="商品" min-width="150" />
            <el-table-column label="实际数量" width="88" align="right"><template #default="{ row }">{{ financeLineBreakdown(row, selectedPo.purchaseConfirmation).qty.toLocaleString() }}</template></el-table-column>
            <el-table-column label="采购单价" width="100" align="right"><template #default="{ row }">{{ confirmationMoney(row.unitPrice) }}</template></el-table-column>
            <el-table-column label="商品货款" width="110" align="right"><template #default="{ row }">{{ confirmationMoney(financeLineBreakdown(row, selectedPo.purchaseConfirmation).goods) }}</template></el-table-column>
            <el-table-column label="国内运费" width="100" align="right"><template #default="{ row }">{{ confirmationMoney(financeLineBreakdown(row, selectedPo.purchaseConfirmation).domesticFreight) }}</template></el-table-column>
            <el-table-column label="税费" width="90" align="right"><template #default="{ row }">{{ confirmationMoney(financeLineBreakdown(row, selectedPo.purchaseConfirmation).tax) }}</template></el-table-column>
            <el-table-column label="SKU 小计" width="120" align="right"><template #default="{ row }"><strong>{{ confirmationMoney(financeLineBreakdown(row, selectedPo.purchaseConfirmation).total) }}</strong></template></el-table-column>
          </el-table>

          <el-descriptions :column="2" border size="small" title="其他费用与总支出">
            <el-descriptions-item label="商品货款">{{ confirmationMoney(financeSummary(selectedPo).goods) }}</el-descriptions-item>
            <el-descriptions-item label="国内运费">{{ confirmationMoney(financeSummary(selectedPo).domesticFreight) }}</el-descriptions-item>
            <el-descriptions-item label="税费">{{ confirmationMoney(financeSummary(selectedPo).tax) }}</el-descriptions-item>
            <el-descriptions-item label="Logo 费用">{{ confirmationMoney(financeSummary(selectedPo).logo) }}</el-descriptions-item>
            <el-descriptions-item label="纸箱费用">{{ confirmationMoney(financeSummary(selectedPo).carton) }}</el-descriptions-item>
            <el-descriptions-item label="备用纸箱费用">{{ confirmationMoney(financeSummary(selectedPo).spareCarton) }}</el-descriptions-item>
            <el-descriptions-item label="预计总支出" :span="2"><strong class="erp-money">{{ confirmationMoney(financeSummary(selectedPo).total) }}</strong></el-descriptions-item>
          </el-descriptions>
        </template>

        <template v-if="selectedPo.purchaseConfirmation">
          <div class="detail-section-title">采购确认信息</div>
          <el-descriptions :column="2" border size="small" title="供应商与产品确认">
            <el-descriptions-item label="预采购单号"><span class="mono">{{ selectedPo.purchaseConfirmation.prePoNo || '—' }}</span></el-descriptions-item>
            <el-descriptions-item label="选品申请单"><span class="mono">{{ selectedPo.purchaseConfirmation.applyNo || '—' }}</span></el-descriptions-item>
            <el-descriptions-item label="规格描述" :span="2">{{ selectedPo.purchaseConfirmation.spec || '—' }}</el-descriptions-item>
            <el-descriptions-item label="联系人">{{ selectedPo.purchaseConfirmation.supplierContactName || '—' }}</el-descriptions-item>
            <el-descriptions-item label="联系电话">{{ selectedPo.purchaseConfirmation.supplierContactPhone || '—' }}</el-descriptions-item>
            <el-descriptions-item label="供应商地址" :span="2">{{ selectedPo.purchaseConfirmation.supplierAddress || '—' }}</el-descriptions-item>
            <el-descriptions-item label="产品链接" :span="2">
              <el-link v-if="selectedPo.purchaseConfirmation.productLink" :href="selectedPo.purchaseConfirmation.productLink" target="_blank" type="primary">打开产品链接</el-link>
              <span v-else>—</span>
            </el-descriptions-item>
            <el-descriptions-item label="产品与配件" :span="2">{{ selectedPo.purchaseConfirmation.accessories || '—' }}</el-descriptions-item>
            <el-descriptions-item label="产品说明书">{{ selectedPo.purchaseConfirmation.manualUrl || '—' }}</el-descriptions-item>
            <el-descriptions-item label="产品图片">{{ selectedPo.purchaseConfirmation.productImageUrl || '—' }}</el-descriptions-item>
          </el-descriptions>

          <el-descriptions :column="3" border size="small" title="价格、交期与尺寸" style="margin-top:16px">
            <el-descriptions-item label="产品起订量">{{ selectedPo.purchaseConfirmation.moq ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="产品交期">{{ selectedPo.purchaseConfirmation.leadTimeDays != null ? `${selectedPo.purchaseConfirmation.leadTimeDays} 天` : '—' }}</el-descriptions-item>
            <el-descriptions-item label="采购谈价">{{ confirmationMoney(selectedPo.purchaseConfirmation.unitPrice) }}</el-descriptions-item>
            <el-descriptions-item label="首批总运费">{{ confirmationMoney(selectedPo.purchaseConfirmation.domesticFreight) }}</el-descriptions-item>
            <el-descriptions-item label="单个运费">{{ confirmationMoney(selectedPo.purchaseConfirmation.unitFreight) }}</el-descriptions-item>
            <el-descriptions-item label="单个税费">{{ confirmationMoney(selectedPo.purchaseConfirmation.unitTax) }}</el-descriptions-item>
            <el-descriptions-item label="税点">{{ selectedPo.purchaseConfirmation.taxRate != null ? `${selectedPo.purchaseConfirmation.taxRate}%` : '—' }}</el-descriptions-item>
            <el-descriptions-item label="开票税点">{{ selectedPo.purchaseConfirmation.invoiceTaxRate != null ? `${selectedPo.purchaseConfirmation.invoiceTaxRate}%` : '—' }}</el-descriptions-item>
            <el-descriptions-item label="包装重量">{{ selectedPo.purchaseConfirmation.packageWeightKg != null ? `${selectedPo.purchaseConfirmation.packageWeightKg} kg` : '—' }}</el-descriptions-item>
            <el-descriptions-item label="产品尺寸">{{ formatConfirmationDimension(selectedPo.purchaseConfirmation, 'product') }}</el-descriptions-item>
            <el-descriptions-item label="产品体积">{{ selectedPo.purchaseConfirmation.productVolumeCbm != null ? `${selectedPo.purchaseConfirmation.productVolumeCbm} m³` : '—' }}</el-descriptions-item>
            <el-descriptions-item label="包装尺寸">{{ formatConfirmationDimension(selectedPo.purchaseConfirmation, 'package') }}</el-descriptions-item>
            <el-descriptions-item label="包装体积">{{ selectedPo.purchaseConfirmation.packageVolumeCbm != null ? `${selectedPo.purchaseConfirmation.packageVolumeCbm} m³` : '—' }}</el-descriptions-item>
            <el-descriptions-item label="包装体积重">{{ selectedPo.purchaseConfirmation.volumetricWeightKg != null ? `${selectedPo.purchaseConfirmation.volumetricWeightKg} kg` : '—' }}</el-descriptions-item>
          </el-descriptions>

          <el-descriptions :column="2" border size="small" title="样品与包装核对" style="margin-top:16px">
            <el-descriptions-item label="样品情况">{{ selectedPo.purchaseConfirmation.sampleStatus || '—' }}</el-descriptions-item>
            <el-descriptions-item label="是否双层纸箱">{{ selectedPo.purchaseConfirmation.doubleLayerCarton == null ? '—' : selectedPo.purchaseConfirmation.doubleLayerCarton ? '是' : '否' }}</el-descriptions-item>
            <el-descriptions-item label="样品包装情况" :span="2">{{ selectedPo.purchaseConfirmation.samplePackageInfo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="样品图片" :span="2">{{ selectedPo.purchaseConfirmation.sampleImageUrl || '—' }}</el-descriptions-item>
            <el-descriptions-item label="Logo 单个费用">{{ confirmationMoney(selectedPo.purchaseConfirmation.logoUnitFee) }}</el-descriptions-item>
            <el-descriptions-item label="Logo 总费用">{{ confirmationMoney(selectedPo.purchaseConfirmation.logoTotalFee) }}</el-descriptions-item>
            <el-descriptions-item label="纸箱总价">{{ confirmationMoney(selectedPo.purchaseConfirmation.cartonTotalPrice) }}</el-descriptions-item>
            <el-descriptions-item label="备用纸箱单价">{{ confirmationMoney(selectedPo.purchaseConfirmation.spareCartonUnitPrice) }}</el-descriptions-item>
            <el-descriptions-item label="备用纸箱数量">{{ selectedPo.purchaseConfirmation.spareCartonQty ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="每箱数量">{{ selectedPo.purchaseConfirmation.piecesPerCarton ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="不采购原因" :span="2">{{ selectedPo.purchaseConfirmation.notPurchaseReason || '—' }}</el-descriptions-item>
          </el-descriptions>
        </template>

        <div class="detail-section-title">SKU 明细</div>
        <el-table :data="selectedPo.items || []" border size="small" style="margin-bottom:20px">
          <el-table-column prop="sku" label="SKU" width="110">
            <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ displaySku(row) }}</span></template>
          </el-table-column>
          <el-table-column prop="productName" label="商品名" min-width="120" />
          <el-table-column label="核定数量" width="88" align="right">
            <template #default="{ row }">{{ row.plannedQty ? row.plannedQty.toLocaleString() : '—' }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="实际采购" width="88" align="right">
            <template #default="{ row }">{{ row.quantity.toLocaleString() }}</template>
          </el-table-column>
          <el-table-column label="单价" width="90" align="right">
            <template #default="{ row }">¥ {{ Number(row.unitPrice).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="国内运费" width="90" align="right">
            <template #default="{ row }">
              {{ row.domesticFreight != null ? `¥ ${Number(row.domesticFreight).toFixed(2)}` : '—' }}
            </template>
          </el-table-column>
          <el-table-column label="小计" width="120" align="right">
            <template #default="{ row }">
              <span style="font-weight:600">¥ {{ fmtMoney(lineDisplayAmount(row, selectedPo.statusKey)) }}</span>
              <span v-if="selectedPo.statusKey === 'pending_actual_qty' && !row.quantity" class="qty-est-hint">预估</span>
            </template>
          </el-table-column>
          <el-table-column prop="receivedQty" label="已收" width="70" align="right" />
          <el-table-column prop="remark" label="行备注" min-width="100" show-overflow-tooltip />
        </el-table>

        <div class="detail-section-title">审核记录</div>
        <el-timeline v-if="auditTimeline.length">
          <el-timeline-item
            v-for="(h, i) in auditTimeline"
            :key="i"
            :timestamp="h.time"
            placement="top"
            :type="(h.type as any)"
          >
            <span style="font-weight:600">{{ h.role }}</span>
            <span style="color:#8b95a8"> · {{ h.action }}</span>
            <div style="font-size:12px;color:#5c6578;margin-top:4px">{{ h.detail }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-if="!auditTimeline.length" description="暂无审核记录" :image-size="60" />
      </template>
    </div>
    <template #footer>
      <div class="detail-footer">
        <el-button :disabled="poActionBusy" @click="detailVisible = false">返回列表</el-button>
        <template v-if="selectedPo?.statusKey === 'pending_actual_qty' && canSetActualQty">
          <el-button type="primary" :disabled="!canOperatePo" @click="submitActualQty(selectedPo)">提交实际采购数量</el-button>
        </template>
        <template v-if="selectedPo?.statusKey === 'pending_po_audit' && canPoAudit">
          <el-button v-if="canEditPendingAudit(selectedPo)" :disabled="!canOperatePo" @click="openRevisePending()">修改订单</el-button>
          <el-button type="danger" plain :disabled="!canOperatePo" @click="rejectPoAudit">驳回</el-button>
          <el-button type="primary" :loading="poActionBusy" :disabled="!canOperatePo" @click="passPoAudit">审核通过</el-button>
        </template>
        <el-button v-else-if="canEditPendingAudit(selectedPo)" :disabled="!canOperatePo" @click="openRevisePending()">修改订单</el-button>
        <el-button v-if="canReopenAudit(selectedPo)" type="warning" plain :disabled="!canOperatePo" @click="reopenPoAudit()">撤回到待审核</el-button>
        <el-button v-if="canCreate && canReviseRejected(selectedPo)" type="primary" :disabled="!canOperatePo" @click="reviseRejectedPo()">修改并重新提交</el-button>
        <el-button v-if="canCreate && canVoidPo(selectedPo)" type="danger" plain :disabled="!canOperatePo || voidingPoId === selectedPo?.id" @click="voidPurchaseOrder(selectedPo)">标为废订单</el-button>
        <el-button v-if="selectedPo?.statusKey === 'finance_approved' && app.hasPerm('logistics_wh.view')" type="primary" :disabled="!canOperatePo" @click="router.push({ path: '/logistics-wh', query: { tab: 'pending', fromPo: selectedPo.poNo } })">前往中转仓收货</el-button>
        <template v-if="canMarkPaid && canShowPayment(selectedPo?.statusKey)">
          <el-button v-if="selectedPo.paymentStatus !== 'paid'" type="success" :disabled="!canOperatePo" @click="markPoPaid()">标记付款</el-button>
          <el-button v-if="selectedPo.paymentStatus !== 'unpaid'" type="warning" plain :disabled="!canOperatePo" @click="markPoUnpaid()">清除打款</el-button>
        </template>
      </div>
    </template>
  </el-drawer>

  <el-dialog v-model="reviseVisible" :title="`修改采购单 · ${reviseForm?.poNo || ''}`" width="720px" :close-on-click-modal="!reviseSaving" :close-on-press-escape="!reviseSaving" :show-close="!reviseSaving">
    <p class="form-tip">保存后仍停留在待审核。审核通过后才会按新的数量和单价重新写入成本。</p>
    <el-form v-if="reviseForm" label-width="96px">
      <el-form-item label="供应商" required>
        <el-select v-model="reviseForm.supplierName" filterable allow-create default-first-option placeholder="选择或输入供应商" style="width:100%">
          <el-option v-for="s in supplierOptions" :key="s.id" :label="s.label" :value="s.label" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标中转仓" required>
        <el-select v-model="reviseForm.warehouseCode" filterable placeholder="选择物流中转仓" style="width:100%">
          <el-option v-for="w in createPoWarehouses" :key="w.warehouseCode || w.code" :label="w.warehouseName || w.name" :value="w.warehouseCode || w.code" />
        </el-select>
      </el-form-item>
      <el-form-item label="预计到货">
        <el-date-picker v-model="reviseForm.expectedArrival" type="date" value-format="YYYY-MM-DD" placeholder="可选" style="width:100%" />
      </el-form-item>
      <el-form-item label="国内运费">
        <el-input-number v-model="reviseForm.domesticFreight" :min="0" :precision="2" controls-position="right" style="width:100%" />
      </el-form-item>
      <el-table :data="reviseForm.lines" border size="small">
        <el-table-column label="SKU" min-width="120"><template #default="{ row }"><el-input v-model="row.sku" /></template></el-table-column>
        <el-table-column label="商品名称" min-width="140"><template #default="{ row }"><el-input v-model="row.productName" /></template></el-table-column>
        <el-table-column label="数量" width="120"><template #default="{ row }"><el-input-number v-model="row.quantity" :min="1" :precision="0" controls-position="right" style="width:100%" /></template></el-table-column>
        <el-table-column label="单价" width="130"><template #default="{ row }"><el-input-number v-model="row.unitPrice" :min="0.01" :precision="2" controls-position="right" style="width:100%" /></template></el-table-column>
      </el-table>
    </el-form>
    <template #footer>
      <el-button :disabled="reviseSaving" @click="reviseVisible = false">取消</el-button>
      <el-button type="primary" :loading="reviseSaving" @click="submitRevisePending">保存并等待审核</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="paymentVisible" title="标记付款" width="460px" :close-on-click-modal="!paymentSaving" :close-on-press-escape="!paymentSaving" :show-close="!paymentSaving">
    <p class="form-tip">采购总额 ¥{{ fmtMoney(selectedPo?.amount || 0) }}，待付 ¥{{ fmtMoney(paymentRemaining(selectedPo)) }}。定金、尾款和全款会分别留下金额。</p>
    <el-form label-width="96px">
      <el-form-item label="付款类型" required>
        <el-select v-model="paymentForm.paymentType" style="width:100%" @change="onPaymentTypeChange">
          <el-option v-for="item in paymentTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="付款金额" required>
        <el-input-number v-model="paymentForm.amount" :min="0.01" :precision="2" :disabled="paymentForm.paymentType === 'full' || paymentSaving" controls-position="right" style="width:100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="paymentForm.remark" maxlength="500" placeholder="付款说明，选填" :disabled="paymentSaving" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="paymentSaving" @click="paymentVisible = false">取消</el-button>
      <el-button type="primary" :loading="paymentSaving" @click="submitPayment">确认登记</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="actualQtyVisible" title="核定实际采购数量" width="460px" :close-on-click-modal="!poActionBusy" :close-on-press-escape="!poActionBusy" :show-close="!poActionBusy">
    <p>商品 {{ selectedPo?.items?.[0]?.sku }}，计划数量 {{ selectedPo?.items?.[0]?.plannedQty ?? '—' }}。提交后进入采购主管审核。</p>
    <el-alert v-if="detailFeedback" :title="detailFeedback" type="warning" :closable="false" role="alert" style="margin-bottom:12px" />
    <el-form label-width="110px" @submit.prevent="saveActualQty">
      <el-form-item label="实际采购数量" required><el-input v-model="actualQtyInput" aria-label="实际采购数量" inputmode="numeric" :disabled="poActionBusy || poActionUncertain" placeholder="请输入大于零的整数" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="poActionBusy" @click="actualQtyVisible = false">返回采购单</el-button>
      <el-button type="primary" :loading="poActionBusy" :disabled="!canOperatePo" @click="saveActualQty">提交数量</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="prePoDialogVisible" :title="prePoResubmitPoId ? `修改并重新提交 · ${prePoResubmitPoNo || editingPrePo?.prePoNo || ''}` : `编辑预采购单 · ${editingPrePo?.prePoNo || ''}`" width="760px" top="4vh" destroy-on-close :close-on-click-modal="!prePoSaving" :close-on-press-escape="!prePoSaving" :show-close="!prePoSaving">
    <el-alert v-if="prePoResubmitPoId" :title="`驳回原因：${prePoResubmitRemark || '请联系审核人核对'}。提交后进入预采购分配，由采购主管重新分配采购员。`" type="warning" :closable="false" style="margin-bottom:12px" />
    <el-alert v-if="prePoFeedback" :title="prePoFeedback" type="warning" :closable="false" role="alert" style="margin-bottom:12px" />
    <el-button v-if="!editingPrePo && !prePoDetailLoading && prePoTargetId" @click="openPrePoEdit({ id: prePoTargetId }, prePoResubmitPoId ? { resubmitPoId: prePoResubmitPoId, remark: prePoResubmitRemark, poNo: prePoResubmitPoNo } : undefined)">重新读取单据</el-button>
    <div v-loading="prePoDetailLoading" style="min-height:120px">
    <el-scrollbar v-if="editingPrePo" max-height="70vh">
      <el-form label-width="112px" class="pre-po-confirm-form" :disabled="prePoSaving || prePoUncertain">
        <el-divider content-position="left">基本信息</el-divider>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="SKU" required><el-input v-model="editingPrePo.sku" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="商品名称" required><el-input v-model="editingPrePo.productName" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="规格描述" required>
          <el-input v-model="editingPrePo.spec" type="textarea" :rows="2" placeholder="请准确填写颜色、型号、材质、尺寸等规格" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="计划数量"><el-input-number v-model="editingPrePo.plannedQty" :min="1" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="产品链接"><el-input v-model="editingPrePo.productLink" placeholder="1688 或产品链接" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="产品与配件"><el-input v-model="editingPrePo.accessories" type="textarea" :rows="2" placeholder="例如：1 个产品、2 个配件" /></el-form-item>

        <el-divider content-position="left">供应商信息</el-divider>
        <el-form-item label="供应商名称" required>
          <el-select v-model="editingPrePo.supplierName" filterable allow-create default-first-option placeholder="选择或直接输入新供应商" style="width:100%">
            <el-option v-for="s in supplierOptions" :key="s.id" :label="s.label" :value="s.label" />
          </el-select>
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="联系人"><el-input v-model="editingPrePo.supplierContactName" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系电话"><el-input v-model="editingPrePo.supplierContactPhone" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="供应商地址"><el-input v-model="editingPrePo.supplierAddress" /></el-form-item>

        <el-divider content-position="left">采购确认</el-divider>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="产品起订量"><el-input-number v-model="editingPrePo.moq" :min="0" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="产品交期（天）"><el-input-number v-model="editingPrePo.leadTimeDays" :min="0" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="采购谈价 (RMB)" required><el-input-number v-model="editingPrePo.unitPrice" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="首批总运费"><el-input-number v-model="editingPrePo.domesticFreight" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="税点 (%)"><el-input-number v-model="editingPrePo.taxRate" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="开票税点 (%)"><el-input-number v-model="editingPrePo.invoiceTaxRate" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="单个税费"><el-input-number v-model="editingPrePo.unitTax" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="单个运费"><el-input-number v-model="editingPrePo.unitFreight" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="收货仓库"><el-select v-model="editingPrePo.warehouseCode" placeholder="可选" clearable filterable style="width:100%"><el-option v-for="w in prePoWarehouses" :key="w.code || w.warehouseCode" :label="w.name || w.warehouseName" :value="w.code || w.warehouseCode" /></el-select></el-form-item></el-col>
        </el-row>
        <el-form-item label="预计到货"><el-date-picker v-model="editingPrePo.expectedArrival" type="date" value-format="YYYY-MM-DD" placeholder="可选" style="width:100%" /></el-form-item>

        <el-divider content-position="left">产品及包装体积</el-divider>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="产品长 (cm)" required><el-input-number v-model="editingPrePo.productLengthCm" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="产品宽 (cm)" required><el-input-number v-model="editingPrePo.productWidthCm" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="产品高 (cm)" required><el-input-number v-model="editingPrePo.productHeightCm" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="产品体积"><el-input :model-value="formatPrePoVolume(editingPrePo, 'product')" readonly /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="包装重量 (kg)"><el-input-number v-model="editingPrePo.packageWeightKg" :min="0" :precision="3" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="包装长 (cm)" required><el-input-number v-model="editingPrePo.packageLengthCm" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="包装宽 (cm)" required><el-input-number v-model="editingPrePo.packageWidthCm" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="包装高 (cm)" required><el-input-number v-model="editingPrePo.packageHeightCm" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="包装体积"><el-input :model-value="formatPrePoVolume(editingPrePo, 'package')" readonly /></el-form-item></el-col>
        </el-row>

        <el-divider content-position="left">样品与包装核对</el-divider>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="样品情况"><el-input v-model="editingPrePo.sampleStatus" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="是否双层纸箱"><el-select v-model="editingPrePo.doubleLayerCarton" clearable style="width:100%"><el-option label="是" :value="true" /><el-option label="否" :value="false" /></el-select></el-form-item></el-col>
        </el-row>
        <el-form-item label="样品包装情况"><el-input v-model="editingPrePo.samplePackageInfo" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="样品图片"><el-input v-model="editingPrePo.sampleImageUrl" placeholder="图片链接" /></el-form-item>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="Logo 单个费用"><el-input-number v-model="editingPrePo.logoUnitFee" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="Logo 总费用"><el-input-number v-model="editingPrePo.logoTotalFee" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="纸箱总价"><el-input-number v-model="editingPrePo.cartonTotalPrice" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="备用纸箱单价"><el-input-number v-model="editingPrePo.spareCartonUnitPrice" :min="0" :precision="2" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="备用纸箱数量"><el-input-number v-model="editingPrePo.spareCartonQty" :min="0" controls-position="right" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="每箱数量"><el-input-number v-model="editingPrePo.piecesPerCarton" :min="0" controls-position="right" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="产品图片"><el-input v-model="editingPrePo.productImageUrl" placeholder="图片链接" /></el-form-item>
        <el-form-item label="产品说明书"><el-input v-model="editingPrePo.manualUrl" placeholder="说明书链接或语言说明" /></el-form-item>
        <el-form-item label="不采购原因"><el-input v-model="editingPrePo.notPurchaseReason" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="editingPrePo.remark" type="textarea" :rows="2" /></el-form-item>
        <p class="form-tip">带 * 的规格描述、产品尺寸和包装尺寸为确认采购必填项；体积会自动按长 × 宽 × 高计算并落库。</p>
      </el-form>
    </el-scrollbar>
    </div>
    <template #footer>
      <el-button :disabled="prePoSaving" @click="prePoDialogVisible = false">返回列表</el-button>
      <el-button v-if="prePoResubmitPoId" type="primary" :loading="prePoSaving" :disabled="!editingPrePo || prePoDetailLoading || prePoUncertain" @click="savePrePoEdit">提交到分配采购员</el-button>
      <el-button v-else type="primary" :loading="prePoSaving" :disabled="!editingPrePo || prePoDetailLoading || prePoUncertain" @click="savePrePoEdit">保存并返回</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="directReviseVisible" :title="`修改并重新提交 · ${directReviseForm?.poNo || ''}`" width="640px" :close-on-click-modal="!directReviseSaving" :close-on-press-escape="!directReviseSaving" :show-close="!directReviseSaving">
    <el-alert :title="`驳回原因：${directReviseForm?.poAuditRemark || '请联系审核人核对'}。提交后进入预采购分配，由采购主管重新分配采购员。`" type="warning" :closable="false" style="margin-bottom:12px" />
    <el-form v-if="directReviseForm" label-width="108px" :disabled="directReviseSaving">
      <el-form-item label="供应商" required>
        <el-select v-model="directReviseForm.supplierName" filterable allow-create default-first-option placeholder="选择或输入供应商" style="width:100%">
          <el-option v-for="s in supplierOptions" :key="s.id" :label="s.label" :value="s.label" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标中转仓">
        <el-select v-model="directReviseForm.warehouseCode" filterable clearable placeholder="选择物流中转仓" style="width:100%">
          <el-option v-for="w in createPoWarehouses" :key="w.warehouseCode || w.code" :label="w.warehouseName || w.name" :value="w.warehouseCode || w.code" />
        </el-select>
      </el-form-item>
      <el-form-item label="SKU" required><el-input v-model="directReviseForm.sku" maxlength="30" /></el-form-item>
      <el-form-item label="商品名称" required><el-input v-model="directReviseForm.productName" maxlength="300" /></el-form-item>
      <el-form-item label="采购数量" required><el-input-number v-model="directReviseForm.quantity" :min="1" :precision="0" style="width:100%" /></el-form-item>
      <el-form-item label="单价" required><el-input-number v-model="directReviseForm.unitPrice" :min="0" :precision="2" style="width:100%" /></el-form-item>
      <el-form-item label="预计到货"><el-date-picker v-model="directReviseForm.expectedArrival" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
      <el-form-item label="国内运费"><el-input-number v-model="directReviseForm.domesticFreight" :min="0" :precision="2" style="width:100%" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="directReviseForm.remark" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="directReviseSaving" @click="directReviseVisible = false">取消</el-button>
      <el-button type="primary" :loading="directReviseSaving" :disabled="!directReviseForm" @click="submitDirectRejectedRevision">提交到分配采购员</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="assignDialogVisible" :title="`分配采购员 · ${assigningRow?.prePoNo || ''}`" width="780px" top="4vh" destroy-on-close :close-on-click-modal="!assignSubmitting" :close-on-press-escape="!assignSubmitting" :show-close="!assignSubmitting">
    <el-scrollbar v-if="assigningRow" v-loading="assignDevLoading" max-height="70vh">
      <el-form label-width="118px" class="assign-detail-form">
        <el-divider content-position="left">基本信息</el-divider>
        <el-form-item label="选品单号"><el-input :model-value="assigningRow.applyNo" readonly /></el-form-item>
        <el-form-item label="预采购单号"><el-input :model-value="assigningRow.prePoNo" readonly /></el-form-item>
        <el-form-item label="商品名称"><el-input :model-value="assigningRow.productName" readonly /></el-form-item>
        <el-form-item label="SKU"><el-input :model-value="assigningRow.sku" readonly /></el-form-item>
        <el-form-item label="规格"><el-input :model-value="assignDisplayVal(assignDevDetail?.spec || assigningRow.spec)" readonly /></el-form-item>
        <el-form-item label="计划数量"><el-input :model-value="String(assigningRow.plannedQty ?? '—')" readonly /></el-form-item>
        <el-form-item v-if="assigningRow.unitPrice != null" label="参考采购价">
          <el-input :model-value="`¥ ${assigningRow.unitPrice}`" readonly />
        </el-form-item>

        <template v-if="assignDevDetail">
          <el-divider content-position="left">链接与图片</el-divider>
          <el-form-item label="Takealot 链接">
            <div class="link-row">
              <el-input :model-value="assignDevDetail.link !== '#' ? assignDevDetail.link : ''" readonly placeholder="未填写" />
              <el-button v-if="assignDevDetail.link && assignDevDetail.link !== '#'" link type="primary" @click="openAssignUrl(assignDevDetail.link, 'Takealot 链接')">打开</el-button>
            </div>
          </el-form-item>
          <el-form-item label="Takealot 售价图">
            <div v-if="assignDevDetail.takealotPriceImageUrl" class="image-preview-row">
              <el-image :src="productDevImageSrc(assignDevDetail.takealotPriceImageUrl)" fit="cover" class="preview-img" :preview-src-list="[productDevImageSrc(assignDevDetail.takealotPriceImageUrl)]" />
            </div>
            <span v-else class="empty-val">—</span>
          </el-form-item>
          <el-form-item label="亚马逊链接">
            <div class="link-row">
              <el-input :model-value="assignDevDetail.amazonUrl || ''" readonly placeholder="未填写" />
              <el-button v-if="assignDevDetail.amazonUrl" link type="primary" @click="openAssignUrl(assignDevDetail.amazonUrl, '亚马逊链接')">打开</el-button>
            </div>
          </el-form-item>
          <el-form-item label="1688 链接">
            <div class="link-row">
              <el-input :model-value="assignDevDetail.alibaba1688Url || ''" readonly placeholder="未填写" />
              <el-button v-if="assignDevDetail.alibaba1688Url" link type="primary" @click="openAssignUrl(assignDevDetail.alibaba1688Url, '1688 链接')">打开</el-button>
            </div>
          </el-form-item>
          <el-form-item label="1688 产品图">
            <div v-if="assignDevDetail.alibaba1688ImageUrl" class="image-preview-row">
              <el-image :src="productDevImageSrc(assignDevDetail.alibaba1688ImageUrl)" fit="cover" class="preview-img" :preview-src-list="[productDevImageSrc(assignDevDetail.alibaba1688ImageUrl)]" />
            </div>
            <span v-else class="empty-val">—</span>
          </el-form-item>

          <el-divider content-position="left">尺寸</el-divider>
          <el-form-item label="产品尺寸">
            <el-input :model-value="formatAssignProductDim(assignDevDetail)" readonly />
          </el-form-item>
          <el-form-item label="包装尺寸">
            <el-input :model-value="formatAssignPackageDim(assignDevDetail)" readonly />
          </el-form-item>
          <el-form-item label="CBM / 体积重">
            <el-input
              :model-value="assignDevDetail.cbm
                ? `${assignDevDetail.cbm} m³ / ${assignDevDetail.volumetricWeightKg || '—'} kg`
                : '—'"
              readonly
            />
          </el-form-item>

          <el-divider content-position="left">价格与物流</el-divider>
          <el-form-item label="采购价格 (RMB)">
            <el-input :model-value="assignDevDetail.cost ? `¥ ${assignDevDetail.cost}` : '—'" readonly />
          </el-form-item>
          <el-form-item label="市场参考价 (R)">
            <el-input :model-value="assignDevDetail.marketPrice ? `R ${assignDevDetail.marketPrice}` : '—'" readonly />
          </el-form-item>
          <el-form-item label="售价 RMB">
            <el-input :model-value="assignDevDetail.sellPriceRmb ? `¥ ${assignDevDetail.sellPriceRmb}` : '—'" readonly />
          </el-form-item>
          <el-form-item label="最高售价 RMB">
            <el-input :model-value="assignDevDetail.maxSellPriceRmb ? `¥ ${assignDevDetail.maxSellPriceRmb}` : '—'" readonly />
          </el-form-item>
          <el-form-item label="海运渠道">
            <el-input :model-value="assignDisplayVal(assignDevDetail.seaFreightChannel)" readonly />
          </el-form-item>

          <el-divider content-position="left">利润试算（开发填报）</el-divider>
          <el-form-item label="预估利润">
            <div v-if="assignDevProfit != null" class="profit-box" :class="{ warn: assignDevProfit < 0 }">
              <span>¥ {{ assignDevProfit.toFixed(2) }}</span>
              <span v-if="assignDevProfitRate != null" class="profit-rate">（利润率 {{ assignDevProfitRate.toFixed(1) }}%）</span>
              <span class="profit-hint">= 售价 RMB − 采购价格（不含海运/平台费）</span>
            </div>
            <span v-else class="form-tip">开发未填写售价或采购价</span>
          </el-form-item>

          <el-divider content-position="left">其他</el-divider>
          <el-form-item label="选品理由">
            <el-input :model-value="assignDisplayVal(assignDevDetail.reason)" type="textarea" :rows="2" readonly />
          </el-form-item>
          <el-form-item v-if="assignDevDetail.auditRemark" label="审核备注">
            <el-input :model-value="assignDevDetail.auditRemark" type="textarea" :rows="2" readonly />
          </el-form-item>
        </template>

        <el-divider content-position="left">分配采购员</el-divider>
        <el-form-item label="采购员" required>
          <el-select v-model="assignPurchaserId" placeholder="选择采购员" :disabled="assignSubmitting" filterable style="width: 100%">
            <el-option v-for="p in purchaserOptions" :key="p.id" :label="p.label" :value="p.id" />
          </el-select>
          <span class="form-tip">分配后采购员可在「预采购单」中编辑并确认采购</span>
        </el-form-item>
      </el-form>
    </el-scrollbar>
    <template #footer>
      <el-button :disabled="assignSubmitting" @click="assignDialogVisible = false">返回列表</el-button>
      <el-button type="primary" :loading="assignSubmitting" :disabled="assignDevLoading || assignSubmitting" @click="submitAssignPurchaser">确认分配</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-weight: 600; font-size: 15px; }
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.callout {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 14px;
  font-size: 13px;
}
.callout.info {
  background: #eef6ff;
  border: 1px solid #c5dff8;
  color: #3d4f63;
}
.callout-title { font-weight: 600; margin-bottom: 4px; }
.callout-body { line-height: 1.5; }

.mono { font-family: var(--font-mono, Consolas, monospace); font-size: 12px; }
.mono.muted { color: #8b95a8; }
.pending-qty { color: #1f9d92; }
.form-tip { font-size: 11px; color: #a39a8c; display: block; margin-top: 4px; }
.link-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.link-row .el-input { flex: 1; }
.assign-detail-form :deep(.el-divider__text) { font-size: 12px; color: #858a8c; }
.image-preview-row { display: flex; gap: 10px; }
.preview-img { width: 80px; height: 80px; border-radius: 6px; border: 1px solid #ece6dd; }
.empty-val { color: #b0a89c; font-size: 13px; }
.profit-box { font-size: 14px; color: #1f9d92; font-weight: 600; }
.profit-box.warn { color: #c4782b; }
.profit-rate { margin-left: 6px; font-weight: 500; }
.profit-hint { display: block; font-size: 11px; color: #a39a8c; font-weight: 400; margin-top: 4px; }

.create-po-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0 4px 24px;
  min-height: 100%;
}

.form-section {
  background: #faf8f4;
  border: 1px solid #ece6dd;
  border-radius: 8px;
  padding: 16px 20px;
}

.section-title {
  font-weight: 600;
  font-size: 14px;
  color: #2b2b2b;
  margin-bottom: 14px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-head .section-title {
  margin-bottom: 0;
}

:deep(.form-section .el-form-item) {
  margin-bottom: 14px;
}

:deep(.form-section .el-form-item__label) {
  font-size: 13px;
  color: #5c5348;
}

.lines-table {
  width: 100%;
}

.lines-table :deep(.line-num-input) {
  width: 100%;
}

.lines-table :deep(.line-num-input .el-input__wrapper) {
  padding-left: 8px;
  padding-right: 8px;
}

.lines-table :deep(.line-num-input .el-input__inner) {
  text-align: center;
}

.sku-suggest-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sku-suggest-name {
  color: #8b95a8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qty-diff { font-size: 11px; }
.qty-diff.diff-ok { color: #1f9d92; }
.qty-diff.diff-warn { color: #c4782b; font-weight: 600; }

.line-amt {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #1f9d92;
}

.po-summary {
  display: flex;
  gap: 32px;
  justify-content: flex-end;
  padding: 14px 20px;
  background: #f0faf9;
  border: 1px solid #b8e6e0;
  border-radius: 8px;
  font-size: 13px;
  color: #5c5348;
}

.total-amt {
  color: #1f9d92;
  font-size: 16px;
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid #ece6dd;
}

.detail-body { padding: 0 4px 20px; }
.detail-section-title { font-weight: 600; font-size: 14px; margin: 20px 0 12px; color: #2b2b2b; }
.detail-footer { display: flex; justify-content: flex-end; gap: 10px; }
.qty-est-hint { display: block; font-size: 10px; color: #a39a8c; font-weight: 400; margin-top: 2px; }
.flow-hint { margin: 0; font-size: 13px; line-height: 1.55; color: inherit; }
.flow-hint + .flow-hint { margin-top: 4px; }
.desc-required-label::before {
  content: '*';
  color: var(--el-color-danger);
  margin-right: 4px;
}
</style>

<style>
.create-po-drawer .el-drawer__body {
  padding: 16px 20px;
  overflow-y: auto;
}

.create-po-sku-popper {
  min-width: 320px !important;
}
</style>
