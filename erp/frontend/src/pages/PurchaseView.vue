<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { purchaseApi, supplierApi, usersApi, productDevApi, warehouseApi, productApi } from '@/api/client.js'
import { mapPurchaseOrder, mapPrePurchaseOrder, mapProductDev } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
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

const app = useAppStore()
const router = useRouter()

const mainTab = ref('orders')
const searchQ = ref('')

const canCreate = computed(() => app.hasPerm('purchase.create'))
const canAssignPurchaser = computed(() => app.hasPerm('purchase.assign'))
const canPoAudit = computed(() => app.hasPerm('purchase.po_audit'))
const canMarkPaid = computed(() => app.hasPerm('purchase.mark_paid'))
const canMingruiOrder = computed(() => app.hasPerm('mingrui.order'))
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

async function loadPrePoPendingAssign() {
  assignLoading.value = true
  try {
    const res = await purchaseApi.listPrePoPendingAssign({ pageSize: 200, keyword: assignSearchQ.value.trim() || undefined })
    assignItems.value = (res.items || []).map(mapPrePurchaseOrder)
  } catch {
    assignItems.value = []
  } finally {
    assignLoading.value = false
  }
}

async function loadMyPrePo() {
  prePoLoading.value = true
  try {
    const res = await purchaseApi.listMyPrePo({ pageSize: 200, keyword: prePoMySearchQ.value.trim() || undefined })
    prePoItems.value = (res.items || []).map(mapPrePurchaseOrder)
  } catch {
    prePoItems.value = []
  } finally {
    prePoLoading.value = false
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
      label: prePoItems.value.length ? `预采购单 (${prePoItems.value.length})` : '预采购单',
    })
  }
  if (canSetActualQty.value) {
    list.push({ id: 'actual_qty', label: '核定实际数量' })
  }
  list.push({ id: 'po_pending', label: '采购审核' }, { id: 'paid', label: '已打款' })
  return list
})

function canShowPayment(statusKey?: string) {
  return ['finance_approved', 'at_logistics_wh', 'received', 'completed', 'approved'].includes(String(statusKey || ''))
}

function goMingruiOrder(row?: { poNo?: string }) {
  const poNo = row?.poNo || selectedPo.value?.poNo
  router.push({ path: '/mingrui', query: poNo ? { poNo } : {} })
}

function poTone(statusKey: string) {
  if (['finance_approved', 'at_logistics_wh', 'received', 'completed'].includes(statusKey)) return 'ok'
  if (statusKey === 'rejected') return 'danger'
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
  if (mainTab.value === 'po_pending') list = list.filter(p => p.statusKey === 'pending_po_audit')
  if (mainTab.value === 'paid') list = list.filter(p => p.paymentStatus === 'paid')
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
watch([mainTab, searchQ], resetPage)

watch(mainTab, (tab) => {
  if (tab === 'pre_assign') loadPrePoPendingAssign()
  if (tab === 'pre_po') loadMyPrePo()
})

const prePoFiltered = computed(() => {
  const q = prePoMySearchQ.value.trim().toLowerCase()
  if (!q) return prePoItems.value
  return prePoItems.value.filter((r) =>
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

watch([mainTab, prePoMySearchQ], () => {
  if (mainTab.value === 'pre_po') resetPrePoPage()
})

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
  } catch {
    supplierOptions.value = []
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
  }, '采购单已创建，进入采购审核')
  if (ok) {
    createPoVisible.value = false
    load()
  }
}

const prePoDialogVisible = ref(false)
const editingPrePo = ref<any>(null)
const prePoWarehouses = ref<any[]>([])

async function openPrePoEdit(row: any) {
  editingPrePo.value = {
    ...row._raw,
    ...row,
    supplierName: row._raw?.supplierName || (row.supplier && row.supplier !== '—' ? row.supplier : ''),
    domesticFreight: row.domesticFreight ?? '',
  }
  prePoDialogVisible.value = true
  if (!supplierOptions.value.length) await loadSupplierOptions()
  if (!prePoWarehouses.value.length) {
    try {
      const { warehouseApi } = await import('@/api/client.js')
      const whRes = await warehouseApi.list()
      prePoWarehouses.value = whRes.items || whRes || []
    } catch {
      prePoWarehouses.value = []
    }
  }
}

async function savePrePoEdit() {
  if (!editingPrePo.value) return
  const f = editingPrePo.value
  const ok = await withAction(async () => {
    await purchaseApi.updatePrePo(f.id, {
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
      warehouseCode: f.warehouseCode || undefined,
      expectedArrival: f.expectedArrival || undefined,
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
    })
  }, '预采购单已保存')
  if (ok) {
    prePoDialogVisible.value = false
    loadMyPrePo()
  }
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
  try {
    const { value } = await ElMessageBox.prompt('请填写取消采购原因', '取消预采购', {
      confirmButtonText: '确认取消',
      cancelButtonText: '返回',
      inputPattern: /\S+/,
      inputErrorMessage: '原因不能为空',
      type: 'warning',
    })
    const ok = await withAction(async () => {
      await purchaseApi.cancelPrePo(row.id, { reason: value })
    }, '预采购已取消')
    if (ok) loadMyPrePo()
  } catch { /* cancelled */ }
}

async function confirmPrePoRow(row: any) {
  try {
    await ElMessageBox.confirm(
      `确认预采购单 ${row.prePoNo}？将生成正式采购单，实际数量需产品主管核定。`,
      '确认采购',
      { type: 'info' },
    )
    const ok = await withAction(async () => {
      await purchaseApi.confirmPrePo(row.id)
    }, '已生成正式采购单')
    if (ok) {
      loadMyPrePo()
      load()
    }
  } catch { /* cancelled */ }
}

async function submitActualQty(po: any) {
  const line = po.items?.[0]
  if (!line) return
  try {
    const { value } = await ElMessageBox.prompt(
      `计划数量 ${line.plannedQty ?? '—'}，请填写实际采购数量`,
      `核定实际数量 · ${line.sku}`,
      {
        confirmButtonText: '提交',
        cancelButtonText: '取消',
        inputPattern: /^[1-9]\d*$/,
        inputErrorMessage: '请输入有效数量',
      },
    )
    const ok = await withAction(async () => {
      await purchaseApi.setActualQty(po.id, { quantity: Number(value) })
    }, '实际数量已提交，进入采购审核')
    if (ok) {
      detailVisible.value = false
      load()
    }
  } catch { /* cancelled */ }
}

const assignDialogVisible = ref(false)
const assigningRow = ref<any>(null)
const assignDevDetail = ref<any>(null)
const assignDevLoading = ref(false)
const assignPurchaserId = ref<number | null>(null)
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
    const res = await usersApi.list({ roleCode: 'purchaser', pageSize: 100 })
    purchaserOptions.value = (res.items || []).map((u: any) => ({
      id: Number(u.id),
      label: u.realName || u.username,
    }))
  } catch {
    purchaserOptions.value = []
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
  if (!assigningRow.value) return
  if (!assignPurchaserId.value) {
    ElMessage.warning('请选择采购员')
    return
  }
  const purchaser = purchaserOptions.value.find((p) => p.id === assignPurchaserId.value)
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
}

const detailVisible = ref(false)
const detailLoading = ref(false)
const selectedPo = ref<any>(null)
const auditWarehouseCode = ref('')
const auditWarehouses = ref<any[]>([])

async function loadAuditWarehouses() {
  if (auditWarehouses.value.length) return
  try {
    const result = await warehouseApi.list({ type: 'logistics' })
    auditWarehouses.value = result.items || result || []
  } catch {
    auditWarehouses.value = []
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
    steps.push({
      time: p.auditedAtStr,
      role: p.auditorName,
      action: p.statusKey === 'rejected' && p.poAuditRemark ? '采购主管驳回' : '采购主管审核',
      detail: p.poAuditRemark || '—',
      type: p.statusKey === 'rejected' && p.poAuditRemark && !p.financeAtStr ? 'danger' : 'success',
    })
  }
  if (p.financeAtStr) {
    steps.push({
      time: p.financeAtStr,
      role: p.financeName,
      action: p.statusKey === 'rejected' && p.financeRemark ? '财务驳回' : '财务审核',
      detail: p.financeRemark || '—',
      type: p.statusKey === 'rejected' && p.financeRemark ? 'danger' : 'success',
    })
  }
  if (p.paidAtStr) {
    steps.push({
      time: p.paidAtStr,
      role: p.paidByName,
      action: '标记已打款',
      detail: '已转财务',
      type: 'success',
    })
  }
  return steps
})

async function openDetail(po: any) {
  detailVisible.value = true
  detailLoading.value = true
  selectedPo.value = po
  auditWarehouseCode.value = ''
  try {
    const detail = await purchaseApi.detail(po.id)
    selectedPo.value = mapPurchaseOrder(detail)
    if (selectedPo.value.statusKey === 'pending_po_audit' && !selectedPo.value.warehouseCode) {
      await loadAuditWarehouses()
    }
  } catch {
    /* keep list row */
  } finally {
    detailLoading.value = false
  }
}

async function passPoAudit() {
  if (!selectedPo.value) return
  const warehouseCode = selectedPo.value.warehouseCode || auditWarehouseCode.value
  if (!warehouseCode) {
    ElMessage.warning('请先选择目标中转仓')
    return
  }
  const ok = await withAction(async () => {
    await purchaseApi.approve(selectedPo.value.id, { remark: '审核通过', warehouseCode })
  }, '采购审核已通过，已同步主数据，可安排入库；打款后将转财务')
  if (ok) {
    detailVisible.value = false
    load()
  }
}

async function rejectPoAudit() {
  if (!selectedPo.value) return
  try {
    const { value } = await ElMessageBox.prompt('请填写驳回原因，将退回采购员修改', '采购主管驳回', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '驳回原因不能为空',
      type: 'warning',
    })
    const ok = await withAction(async () => {
      await purchaseApi.rejectPoAudit(selectedPo.value.id, { remark: value })
    }, '采购单已驳回')
    if (ok) {
      detailVisible.value = false
      load()
    }
  } catch { /* cancelled */ }
}

async function markPoPaid() {
  if (!selectedPo.value) return
  const ok = await withAction(async () => {
    await purchaseApi.markPaid(selectedPo.value.id, { remark: '已打款' })
  }, '已标记打款，费用信息已转财务')
  if (ok) {
    const detail = await purchaseApi.detail(selectedPo.value.id)
    selectedPo.value = mapPurchaseOrder(detail)
    load()
  }
}

async function markPoUnpaid() {
  if (!selectedPo.value) return
  const ok = await withAction(async () => {
    await purchaseApi.markUnpaid(selectedPo.value.id)
  }, '已改回未打款')
  if (ok) {
    const detail = await purchaseApi.detail(selectedPo.value.id)
    selectedPo.value = mapPurchaseOrder(detail)
    load()
  }
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
            <el-input v-else-if="mainTab === 'orders' || mainTab === 'po_pending' || mainTab === 'paid' || mainTab === 'actual_qty'" v-model="searchQ" placeholder="搜索单号 / SKU / 供应商" clearable style="width:200px" size="small" />
            <el-button v-if="canCreate && mainTab === 'orders'" type="primary" size="small" @click="openCreatePo">+ 创建采购单</el-button>
          </div>
        </div>
      </template>

      <el-tabs v-model="mainTab" type="card">
        <el-tab-pane v-for="tab in tabs" :key="tab.id" :label="tab.label" :name="tab.id" />
      </el-tabs>

      <div v-if="mainTab === 'pre_assign'" class="pending-skus-panel">
        <div class="callout info">
          <div class="callout-title">预采购单分配（采购主管）</div>
          <div class="callout-body">{{ PIPELINE_PURCHASE_ASSIGN }}</div>
        </div>
        <el-table v-loading="assignLoading" :data="assignPagedItems" stripe border size="small">
          <el-table-column prop="prePoNo" label="预采购单号" width="130"><template #default="{ row }"><span class="mono">{{ row.prePoNo }}</span></template></el-table-column>
          <el-table-column prop="applyNo" label="选品单号" width="120" />
          <el-table-column prop="sku" label="SKU" width="110"><template #default="{ row }"><span class="mono">{{ row.sku }}</span></template></el-table-column>
          <el-table-column prop="productName" label="商品名称" min-width="140" show-overflow-tooltip />
          <el-table-column label="计划数量" width="90" align="right"><template #default="{ row }">{{ row.plannedQty }}</template></el-table-column>
          <el-table-column label="参考单价" width="90" align="right"><template #default="{ row }">{{ row.unitPrice != null ? `¥ ${row.unitPrice}` : '—' }}</template></el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canAssignPurchaser" link type="primary" size="small" @click="openAssignDialog(row)">分配采购员</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!assignLoading && !assignFiltered.length" description="暂无待分配预采购单" />
        <ListPagination v-model:page="assignPage" v-model:page-size="assignPageSize" :total="assignTotal" />
      </div>

      <div v-else-if="mainTab === 'pre_po'" class="pending-skus-panel">
        <div class="callout info">
          <div class="callout-title">我的预采购单</div>
          <div class="callout-body">{{ PIPELINE_PRE_PO }}</div>
        </div>
        <el-table v-loading="prePoLoading" :data="prePoPagedItems" stripe border size="small">
          <el-table-column prop="prePoNo" label="预采购单号" width="130"><template #default="{ row }"><span class="mono">{{ row.prePoNo }}</span></template></el-table-column>
          <el-table-column prop="sku" label="SKU" width="110"><template #default="{ row }"><span class="mono">{{ row.sku }}</span></template></el-table-column>
          <el-table-column prop="productName" label="商品名称" min-width="130" show-overflow-tooltip />
          <el-table-column prop="supplier" label="供应商" width="110" show-overflow-tooltip />
          <el-table-column label="单价" width="80" align="right"><template #default="{ row }">{{ row.unitPrice != null ? `¥ ${row.unitPrice}` : '—' }}</template></el-table-column>
          <el-table-column label="计划量" width="70" align="right"><template #default="{ row }">{{ row.plannedQty }}</template></el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openPrePoEdit(row)">编辑</el-button>
              <el-button link type="success" size="small" @click="confirmPrePoRow(row)">确认采购</el-button>
              <el-button link type="danger" size="small" @click="cancelPrePoRow(row)">取消</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!prePoLoading && !prePoFiltered.length" description="暂无预采购单" />
        <ListPagination v-model:page="prePoPage" v-model:page-size="prePoPageSize" :total="prePoTotal" />
      </div>

      <template v-else-if="mainTab === 'orders' || mainTab === 'po_pending' || mainTab === 'paid' || mainTab === 'actual_qty'">
      <el-alert v-if="mainTab === 'orders'" type="info" :closable="false" show-icon style="margin-bottom:12px">
      <p class="flow-hint">{{ PIPELINE_PURCHASE_ORDERS }}</p>
      </el-alert>
      <el-alert v-if="mainTab === 'actual_qty'" type="warning" :closable="false" show-icon style="margin-bottom:12px">
        产品主管在此核定实际采购数量，提交后进入「采购审核」。
      </el-alert>
      <el-alert v-if="mainTab === 'paid'" type="info" :closable="false" show-icon style="margin-bottom:12px">
        已打款采购单已转财务。采购主管可继续「明瑞物流下单」订舱发运海外仓。财务可查看费用明细，但不能修改打款状态。
      </el-alert>
      <el-table v-loading="loading" :data="pagedItems" stripe border style="width: 100%" size="small">
        <el-table-column prop="poNo" label="采购单号" width="150">
          <template #default="{ row }">
            <span style="font-family: var(--font-mono); font-size: 12px; color: #2563eb; cursor: pointer" @click="openDetail(row)">{{ row.poNo }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="skuLabel" label="SKU" width="110">
          <template #default="{ row }"><span class="mono">{{ row.skuLabel }}</span></template>
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
        <el-table-column label="打款" width="90">
          <template #default="{ row }">
            <el-tag v-if="canShowPayment(row.statusKey)" :type="row.paymentStatus === 'paid' ? 'success' : 'warning'" size="small">
              {{ row.paymentStatusLabel || (row.paymentStatus === 'paid' ? '已打款' : '未打款') }}
            </el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAtStr" label="创建时间" width="110" />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">
              {{ (canSetActualQty && row.statusKey === 'pending_actual_qty') ? '核定数量' : (canPoAudit && row.statusKey === 'pending_po_audit') ? '去审核' : '详情' }}
            </el-button>
            <el-button v-if="canMingruiOrder && canShowPayment(row.statusKey)" link type="success" size="small" @click="goMingruiOrder(row)">明瑞下单</el-button>
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
        <div class="callout-body">可直接创建正式采购单，无需经过预采购流程。提交后进入「采购审核」。</div>
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
                @select="(item) => onCreatePoLineSkuSelect(row, item)"
                @blur="onCreatePoLineSkuBlur(row)"
              >
                <template #default="{ item }">
                  <div class="sku-suggest-item">
                    <span class="mono">{{ item.sku }}</span>
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

  <el-drawer v-model="detailVisible" :title="(selectedPo?.poNo || '') + ' · 采购单详情'" size="960px" direction="rtl" class="erp-detail">
    <div v-loading="detailLoading" class="detail-body">
      <template v-if="selectedPo">
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
          <el-descriptions-item label="目标中转仓">
            <el-select
              v-if="selectedPo.statusKey === 'pending_po_audit' && canPoAudit && !selectedPo.warehouseCode"
              v-model="auditWarehouseCode"
              placeholder="请选择物流中转仓"
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
            <el-tag :type="selectedPo.paymentStatus === 'paid' ? 'success' : 'warning'" size="small">
              {{ selectedPo.paymentStatus === 'paid' ? '已打款' : '未打款' }}
            </el-tag>
            <span v-if="selectedPo.paymentStatus === 'paid'" class="form-tip">
              {{ selectedPo.paidByName }} · {{ selectedPo.paidAtStr }} · 已转财务
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ selectedPo.remark || '—' }}</el-descriptions-item>
        </el-descriptions>

        <template v-if="canShowPayment(selectedPo.statusKey)">
          <div class="detail-section-title">费用明细（转财务）</div>
          <el-descriptions :column="2" border size="small" title="单据信息">
            <el-descriptions-item label="采购单号"><span class="mono">{{ selectedPo.poNo }}</span></el-descriptions-item>
            <el-descriptions-item label="供应商">{{ selectedPo.supplier }}</el-descriptions-item>
            <el-descriptions-item label="采购员">{{ selectedPo.purchaserName }}</el-descriptions-item>
            <el-descriptions-item label="预计到货">{{ selectedPo.expectedArrivalStr || '—' }}</el-descriptions-item>
          </el-descriptions>

          <div class="detail-section-title">SKU 费用明细</div>
          <el-table :data="selectedPo.items || []" border size="small" style="margin-bottom:16px">
            <el-table-column prop="sku" label="SKU" width="130"><template #default="{ row }"><span class="mono">{{ row.sku }}</span></template></el-table-column>
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
            <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.sku }}</span></template>
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
        <el-button @click="detailVisible = false">关闭</el-button>
        <template v-if="selectedPo?.statusKey === 'pending_actual_qty' && canSetActualQty">
          <el-button type="primary" @click="submitActualQty(selectedPo)">提交实际采购数量</el-button>
        </template>
        <template v-if="selectedPo?.statusKey === 'pending_po_audit' && canPoAudit">
          <el-button type="danger" plain @click="rejectPoAudit">驳回</el-button>
          <el-button type="primary" @click="passPoAudit">审核通过</el-button>
        </template>
        <template v-if="canMarkPaid && canShowPayment(selectedPo?.statusKey)">
          <el-button v-if="selectedPo.paymentStatus !== 'paid'" type="success" @click="markPoPaid">标记已打款</el-button>
          <el-button v-else type="warning" plain @click="markPoUnpaid">标记未打款</el-button>
        </template>
        <el-button v-if="canMingruiOrder && canShowPayment(selectedPo?.statusKey)" type="primary" @click="goMingruiOrder(selectedPo)">明瑞物流下单</el-button>
      </div>
    </template>
  </el-drawer>

  <el-dialog v-model="prePoDialogVisible" :title="`编辑预采购单 · ${editingPrePo?.prePoNo || ''}`" width="760px" top="4vh" destroy-on-close>
    <el-scrollbar v-if="editingPrePo" max-height="70vh">
      <el-form label-width="112px" class="pre-po-confirm-form">
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
    <template #footer>
      <el-button @click="prePoDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="savePrePoEdit">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="assignDialogVisible" :title="`分配采购员 · ${assigningRow?.prePoNo || ''}`" width="780px" top="4vh" destroy-on-close>
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
          <el-select v-model="assignPurchaserId" placeholder="选择采购员" filterable style="width: 100%">
            <el-option v-for="p in purchaserOptions" :key="p.id" :label="p.label" :value="p.id" />
          </el-select>
          <span class="form-tip">分配后采购员可在「预采购单」中编辑并确认采购</span>
        </el-form-item>
      </el-form>
    </el-scrollbar>
    <template #footer>
      <el-button @click="assignDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="assignDevLoading" @click="submitAssignPurchaser">确认分配</el-button>
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
