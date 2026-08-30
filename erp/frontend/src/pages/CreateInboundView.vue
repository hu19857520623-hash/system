<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { warehouseApi, inboundApi, inventoryApi, productApi } from '@/api/client.js'
import { mapInbound } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import { triggerBlobDownload } from '@/composables/useAsyncIo'
import { useAppStore } from '@/stores/app'
import { getInboundStatusMeta } from '@/constants/index.js'
import ListPagination from '@/components/ListPagination.vue'
import { PIPELINE_INBOUND_CALLOUT } from '@/constants/productPipeline.ts'
import {
  allocateSeaFreight,
  calculateCbmLabel,
  calculateLineCbm,
} from '@/features/inbound/calculations'
import {
  downloadInboundSkuTemplate,
  resolveInboundSkuColumns,
  validateInboundSkuImportRow,
} from '@/constants/importTemplates.ts'
import { normalizeImportFileText, parseCsvLine } from '@/utils/csv.ts'

const DRAFT_KEY = 'erp-inbound-drafts' // legacy localStorage key — migrated to API

const app = useAppStore()
const route = useRoute()
const { showDetail, confirmAction, toast } = useRowActions()

const tab = ref<'form' | 'drafts' | 'list'>('list')
const inboundSearchQ = ref('')

interface InboundLine {
  sku: string
  productName: string
  spec: string
  expectedQty: number
  unitPrice: number
  productId: number
  remark: string
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  maxAvailable: number
}

interface CartonForm {
  boxCode: string
  items: { sku: string; qty: number }[]
}

interface DraftRow {
  id: string
  supplier: string
  sku: string
  qty: number
  savedAt: string
  _form: ReturnType<typeof emptyForm>
}

interface WhSku {
  sku: string
  productName: string
  spec: string
  productId: number
  available: number
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
}

const { loading, items: inbounds, load } = useListLoader(async () => {
  const res = await inboundApi.list({ pageSize: 100 })
  const productMap = await loadProductDimMap()
  return {
    items: (res.items || []).map((r: any) => {
      const mapped = mapInbound(r)
      const qty = (r.items || []).reduce((s: number, i: any) => s + (i.expectedQty || 0), 0)
      const skuLabel = r.items?.length
        ? r.items.length === 1 ? r.items[0].sku : `${r.items[0].sku} 等 ${r.items.length} SKU`
        : '—'
      const st = getInboundStatusMeta(r.displayStatus || r.status)
      const meta = parseInboundMeta(r.remark)
      const cbm = calculateCbmLabel(r.items || [], productMap)
      return {
        ...mapped,
        id: mapped.inboundNo,
        sku: skuLabel,
        qty,
        statusLabel: st.label,
        tone: st.tone,
        warehouseNo: meta.warehouseNo,
        arrival: meta.arrival,
        displayRemark: meta.userRemark,
        cbm,
        _raw: r,
      }
    }),
    total: res.total,
  }
})

const logisticsWarehouses = ref<any[]>([])
const overseasWarehouses = ref<any[]>([])
const warehouseSkus = ref<WhSku[]>([])
const productDimMap = ref<Map<string, { lengthCm: number; widthCm: number; heightCm: number; weightKg: number }>>(new Map())
const productDimMapLoaded = ref(false)
const createLoading = ref(false)
const skuLoading = ref(false)
const editingDraftId = ref<string | null>(null)
const skuFileInputRef = ref<HTMLInputElement | null>(null)
const attachmentInputRef = ref<HTMLInputElement | null>(null)

function numDim(v: unknown): number {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function extractProductDims(p: {
  lengthCm?: unknown
  widthCm?: unknown
  heightCm?: unknown
  weightKg?: unknown
  measuredLengthCm?: unknown
  measuredWidthCm?: unknown
  measuredHeightCm?: unknown
  measuredWeightKg?: unknown
}) {
  return {
    lengthCm: numDim(p.measuredLengthCm ?? p.lengthCm),
    widthCm: numDim(p.measuredWidthCm ?? p.widthCm),
    heightCm: numDim(p.measuredHeightCm ?? p.heightCm),
    weightKg: numDim(p.measuredWeightKg ?? p.weightKg),
  }
}

async function loadProductDimMap(force = false) {
  if (productDimMapLoaded.value && !force) return productDimMap.value
  const map = new Map(productDimMap.value)
  try {
    let page = 1
    while (true) {
      const res = await productApi.list({ pageSize: 200, page })
      const items = res.items || res || []
      items.forEach((p: any) => {
        map.set(p.sku, extractProductDims(p))
      })
      const total = Number(res.total ?? items.length)
      if (items.length < 200 || page * 200 >= total) break
      page += 1
    }
    productDimMap.value = map
    productDimMapLoaded.value = true
  } catch {
    /* 保留已加载的部分 */
  }
  return productDimMap.value
}

function skuOptionLabel(s: WhSku) {
  const name = s.productName ? ` · ${s.productName}` : ''
  return `${s.sku}${name} · 可发 ${s.available}`
}

async function hydrateWarehouseSkuDims(rows: WhSku[]) {
  const missing = rows.filter((row) => row.productId && !row.lengthCm && !row.widthCm && !row.heightCm)
  if (!missing.length) return
  await Promise.all(missing.map(async (row) => {
    try {
      const detail = await productApi.detail(row.productId)
      const dims = extractProductDims(detail)
      if (!dims.lengthCm && !dims.widthCm && !dims.heightCm && !dims.weightKg) return
      productDimMap.value.set(row.sku, dims)
      row.lengthCm = dims.lengthCm
      row.widthCm = dims.widthCm
      row.heightCm = dims.heightCm
      row.weightKg = dims.weightKg
    } catch {
      /* 单条失败不影响其余 SKU */
    }
  }))
}

function parseInboundMeta(remark?: string) {
  const raw = remark || ''
  const warehouseNo = raw.match(/入仓:([^\s]+)/)?.[1] || ''
  const arrival = raw.match(/到货:(\d{4}-\d{2}-\d{2})/)?.[1] || ''
  const userRemark = raw
    .replace(/\[.*?\]/g, '')
    .replace(/入仓:[^\s]+/g, '')
    .replace(/到货:\d{4}-\d{2}-\d{2}/g, '')
    .replace(/海运:[^\s]+/g, '')
    .replace(/承运:[^\s]+/g, '')
    .replace(/运单:[^\s]+/g, '')
    .trim()
  return { warehouseNo, arrival, userRemark: userRemark || '—' }
}

async function loadRefs() {
  createLoading.value = true
  try {
    const [logRes, ovsRes] = await Promise.all([
      warehouseApi.list({ type: 'logistics' }),
      warehouseApi.list({ type: 'overseas' }),
    ])
    logisticsWarehouses.value = Array.isArray(logRes) ? logRes : (logRes.items || [])
    overseasWarehouses.value = Array.isArray(ovsRes) ? ovsRes : (ovsRes.items || [])
    await loadProductDimMap()
  } catch {
    logisticsWarehouses.value = []
    overseasWarehouses.value = []
  } finally {
    createLoading.value = false
  }
}

onMounted(async () => {
  load()
  await loadRefs()
  loadDrafts()
  const wh = String(route.query.wh || '')
  const sku = String(route.query.sku || '')
  if (wh) {
    createForm.value.logisticsWhCode = wh
    tab.value = 'form'
    await loadLogisticsStock(wh)
    if (sku) {
      const line = buildLineFromSku(sku, 1)
      if (line) createForm.value.lines = [line]
    }
  }
})

const filteredInbounds = computed(() => {
  const q = inboundSearchQ.value.trim().toLowerCase()
  if (!q) return inbounds.value
  return inbounds.value.filter((r: any) =>
    String(r.id).toLowerCase().includes(q)
    || String(r.sku).toLowerCase().includes(q),
  )
})

const listStats = computed(() => {
  const rows = filteredInbounds.value
  let pendingReceipt = 0
  let pendingPutaway = 0
  let completed = 0
  let cbmTotal = 0
  let hasCbm = false
  rows.forEach((r: any) => {
    const st = r._raw?.status
    if (st === 'pending_putaway') pendingPutaway++
    else if (r.tone === 'warn' || st === 'exception') pendingReceipt++
    if (r.tone === 'ok') completed++
    if (r.cbm !== '—') {
      cbmTotal += parseFloat(r.cbm)
      hasCbm = true
    }
  })
  return {
    total: rows.length,
    pendingReceipt,
    pendingPutaway,
    completed,
    cbm: hasCbm ? cbmTotal.toFixed(3) : '—',
  }
})

const { page: inboundPage, pageSize: inboundPageSize, total: inboundTotal, pagedItems: inboundPagedItems } = useTablePagination(filteredInbounds)
const drafts = ref<DraftRow[]>([])
const { page: draftPage, pageSize: draftPageSize, total: draftTotal, pagedItems: draftPagedItems } = useTablePagination(drafts)

function emptyForm() {
  return {
    inboundNo: '',
    logisticsWhCode: '',
    destWarehouseCode: '',
    plannedDate: '',
    warehouseNo: '',
    remark: '',
    seaFreightMode: 'lcl' as 'lcl' | 'fcl',
    seaFreightAmounts: { lcl: '', fcl: '' },
    lines: [] as InboundLine[],
    cartons: [] as CartonForm[],
  }
}

const createForm = ref(emptyForm())

const seaFreightTotal = computed(() => {
  const mode = createForm.value.seaFreightMode
  const raw = createForm.value.seaFreightAmounts[mode]
  const n = parseFloat(String(raw || '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
})

const freightAllocLines = computed(() =>
  allocateSeaFreight(createForm.value.lines, seaFreightTotal.value),
)

const missingDimSkus = computed(() =>
  createForm.value.lines
    .filter((l) => l.sku && l.expectedQty > 0 && (!l.lengthCm || !l.widthCm || !l.heightCm))
    .map((l) => l.sku),
)

const canCalcFreight = computed(() =>
  seaFreightTotal.value > 0
  && volumeTotals.value.cbm !== '—'
  && freightAllocLines.value.some((l) => l.lineCbm > 0),
)

const volumeTotals = computed(() => {
  let cbm = 0
  let weight = 0
  let has = false
  createForm.value.lines.forEach((ln) => {
    if (!ln.sku || !ln.expectedQty) return
    const lineCbm = calculateLineCbm(ln)
    if (lineCbm) {
      cbm += lineCbm
      has = true
    }
    if (ln.weightKg) weight += ln.weightKg * ln.expectedQty
  })
  return {
    cbm: has ? cbm.toFixed(3) : '—',
    weight: weight ? weight.toFixed(2) : '—',
  }
})

const totalExpectedQty = computed(() =>
  createForm.value.lines.reduce((s, l) => s + (Number(l.expectedQty) || 0), 0),
)

const totalAmount = computed(() =>
  createForm.value.lines.reduce((s, l) => s + (Number(l.expectedQty) || 0) * (Number(l.unitPrice) || 0), 0),
)

const canCreateInbound = computed(() => app.hasPerm('create_inbound.create'))

function mapDraftRow(d: any): DraftRow {
  const form = d._form || d.formData || {}
  const lines = form.lines || []
  const skuLabel = lines.length === 1
    ? lines[0]?.sku
    : lines.length ? `${lines[0]?.sku || '—'} 等 ${lines.length} SKU` : '—'
  return {
    id: d.id || d.draftNo,
    supplier: '—',
    sku: skuLabel || '—',
    qty: lines.reduce((s: number, l: InboundLine) => s + (Number(l.expectedQty) || 0), 0),
    savedAt: d.savedAt ? new Date(d.savedAt).toLocaleString('zh-CN') : '—',
    _form: form,
  }
}

async function loadDrafts() {
  try {
    const rows = await inboundApi.listDrafts()
    drafts.value = (Array.isArray(rows) ? rows : []).map(mapDraftRow)
  } catch {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      drafts.value = raw ? JSON.parse(raw) : []
    } catch {
      drafts.value = []
    }
  }
}

function emptyLine(): InboundLine {
  return {
    sku: '', productName: '', spec: '', expectedQty: 1, unitPrice: 0,
    productId: 0, remark: '', lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0, maxAvailable: 0,
  }
}

function getSkuAvailable(sku: string) {
  return warehouseSkus.value.find((s) => s.sku === sku)?.available ?? 0
}

function getLineMaxQty(line: any) {
  const available = getSkuAvailable(line.sku) || line.maxAvailable
  if (!available) return 1
  const usedElsewhere = createForm.value.lines
    .filter((l) => l.sku === line.sku && l !== line)
    .reduce((s, l) => s + (Number(l.expectedQty) || 0), 0)
  return Math.max(1, available - usedElsewhere)
}

function clampLineQty(line: any, val?: number) {
  const max = getLineMaxQty(line)
  const n = Number(val ?? line.expectedQty) || 1
  if (n > max) {
    line.expectedQty = max
    ElMessage.warning(`SKU「${line.sku}」入库数量不能超过本仓可发 ${max} 件`)
  } else {
    line.expectedQty = Math.max(1, n)
  }
}

async function loadLogisticsStock(code: string) {
  if (!code) {
    warehouseSkus.value = []
    return
  }
  skuLoading.value = true
  try {
    await loadProductDimMap()
    const allItems: any[] = []
    let page = 1
    while (true) {
      const invRes = await inventoryApi.query({
        warehouseCode: code,
        pageSize: 200,
        page,
        onlyAvailable: '1',
      })
      const batch = invRes.items || []
      allItems.push(...batch)
      const total = Number(invRes.total ?? batch.length)
      if (batch.length < 200 || allItems.length >= total) break
      page += 1
    }

    warehouseSkus.value = allItems
      .filter((r: any) => numDim(r.availableQty ?? r.available) > 0)
      .map((r: any) => {
        const dim = productDimMap.value.get(r.sku) || {
          lengthCm: 0,
          widthCm: 0,
          heightCm: 0,
          weightKg: 0,
        }
        return {
          sku: r.sku,
          productName: r.productName || '',
          spec: r.spec || '',
          productId: Number(r.productId),
          available: numDim(r.availableQty ?? r.available),
          lengthCm: dim.lengthCm || 0,
          widthCm: dim.widthCm || 0,
          heightCm: dim.heightCm || 0,
          weightKg: dim.weightKg || 0,
        }
      })

    await hydrateWarehouseSkuDims(warehouseSkus.value)

    for (const line of createForm.value.lines) {
      if (line.sku) onLineSkuPick(line, line.sku)
    }
  } catch {
    warehouseSkus.value = []
  } finally {
    skuLoading.value = false
  }
}

function onLineSkuPick(line: any, sku: string) {
  const wh = warehouseSkus.value.find((s) => s.sku === sku)
  if (!wh) return
  line.sku = wh.sku
  line.productName = wh.productName
  line.spec = wh.spec
  line.productId = wh.productId
  line.lengthCm = wh.lengthCm
  line.widthCm = wh.widthCm
  line.heightCm = wh.heightCm
  line.weightKg = wh.weightKg
  line.maxAvailable = wh.available
  if (!line.expectedQty || line.expectedQty > wh.available) {
    line.expectedQty = Math.min(Math.max(1, line.expectedQty || 1), wh.available || 1)
  }
}

function addLine() {
  createForm.value.lines.push(emptyLine())
}

function removeLine(idx: number) {
  createForm.value.lines.splice(idx, 1)
}

function formatCubic(l: number, w: number, h: number) {
  if (!l || !w || !h) return '—'
  return `${l}×${w}×${h}`
}

function formatMoney(n: number) {
  return `¥ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function freightLabel(sku: string, field: 'lineFreight' | 'unitFreight') {
  const f = freightAllocLines.value.find((l) => l.sku === sku)?.[field]
  return f ? formatMoney(f) : '—'
}

function volumePctLabel(sku: string) {
  const row = freightAllocLines.value.find((l) => l.sku === sku)
  if (!row?.lineCbm) return '—'
  return `${row.volumePct.toFixed(1)}%`
}

function buildLineFromSku(
  sku: string,
  expectedQty: number,
  remark = '',
  dims?: { lengthCm?: number; widthCm?: number; heightCm?: number; weightKg?: number },
): InboundLine | null {
  const wh = warehouseSkus.value.find((s) => s.sku === sku)
  if (!wh) return null
  const line = emptyLine()
  onLineSkuPick(line, wh.sku)
  line.expectedQty = Math.min(Math.max(1, expectedQty), wh.available || expectedQty)
  line.remark = remark
  if (dims?.lengthCm) line.lengthCm = dims.lengthCm
  if (dims?.widthCm) line.widthCm = dims.widthCm
  if (dims?.heightCm) line.heightCm = dims.heightCm
  if (dims?.weightKg) line.weightKg = dims.weightKg
  return line
}

function downloadSkuTemplate() {
  downloadInboundSkuTemplate()
}

function triggerSkuImport() {
  if (!createForm.value.logisticsWhCode) {
    ElMessage.warning('请先选择始发物流仓')
    return
  }
  skuFileInputRef.value?.click()
}

async function handleSkuImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!createForm.value.logisticsWhCode) {
    ElMessage.warning('请先选择始发物流仓')
    return
  }
  if (!warehouseSkus.value.length && !skuLoading.value) {
    await loadLogisticsStock(createForm.value.logisticsWhCode)
  }
  if (!warehouseSkus.value.length) {
    ElMessage.warning('当前物流仓暂无可发 SKU，无法导入')
    return
  }
  const text = normalizeImportFileText(await file.text())
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) {
    ElMessage.warning('文件为空或仅有表头')
    return
  }
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  const { skuIdx, qtyIdx, lengthIdx, widthIdx, heightIdx, weightIdx, remarkIdx } = resolveInboundSkuColumns(header)
  if (skuIdx < 0) {
    ElMessage.error('导入文件需包含 SKU 列，可先下载最新模板')
    return
  }
  let added = 0
  let updated = 0
  const notFound: string[] = []
  const invalid: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const sku = cols[skuIdx]?.trim()
    if (!sku) continue
    const qty = qtyIdx >= 0 ? Number(cols[qtyIdx]) || 0 : 0
    const remark = remarkIdx >= 0 ? cols[remarkIdx]?.trim() || '' : ''
    const dims = {
      lengthCm: lengthIdx >= 0 ? Number(cols[lengthIdx]) || 0 : 0,
      widthCm: widthIdx >= 0 ? Number(cols[widthIdx]) || 0 : 0,
      heightCm: heightIdx >= 0 ? Number(cols[heightIdx]) || 0 : 0,
      weightKg: weightIdx >= 0 ? Number(cols[weightIdx]) || 0 : 0,
    }
    const rowErr = validateInboundSkuImportRow({
      sku,
      qty,
      lengthCm: dims.lengthCm,
      widthCm: dims.widthCm,
      heightCm: dims.heightCm,
      weightKg: dims.weightKg,
      remark,
    })
    if (rowErr) {
      invalid.push(`第 ${i + 1} 行：${rowErr}`)
      continue
    }
    const built = buildLineFromSku(sku, qty, remark, dims)
    if (!built) { notFound.push(sku); continue }
    const existIdx = createForm.value.lines.findIndex((l) => l.sku === sku)
    if (existIdx >= 0) { createForm.value.lines[existIdx] = built; updated++ }
    else { createForm.value.lines.push(built); added++ }
  }
  if (!added && !updated) {
    const hint = invalid[0] || (notFound.length ? `未匹配到可发 SKU：${notFound.slice(0, 5).join('、')}` : '未解析到有效数据')
    ElMessage.warning(hint)
    return
  }
  let msg = `已导入 ${added + updated} 条 SKU（新增 ${added}，更新 ${updated}）`
  if (notFound.length) msg += `，${notFound.length} 条 SKU 不可发`
  if (invalid.length) msg += `，${invalid.length} 行因必填项缺失已跳过`
  ElMessage.success(msg)
  if (invalid.length) {
    ElMessage.warning(invalid.slice(0, 3).join('；') + (invalid.length > 3 ? '…' : ''))
  }
}

watch(
  () => createForm.value.logisticsWhCode,
  (code) => { loadLogisticsStock(code) },
)

function openCreate() {
  editingDraftId.value = null
  createForm.value = emptyForm()
  if (logisticsWarehouses.value[0]?.warehouseCode) {
    createForm.value.logisticsWhCode = logisticsWarehouses.value[0].warehouseCode
  }
  const dest = overseasWarehouses.value.find((w) => w.warehouseCode === 'WMS-JHB-01') || overseasWarehouses.value[0]
  if (dest) createForm.value.destWarehouseCode = dest.warehouseCode
  tab.value = 'form'
  if (!logisticsWarehouses.value.length) loadRefs()
  else if (createForm.value.logisticsWhCode) loadLogisticsStock(createForm.value.logisticsWhCode)
}

function cancelForm() {
  editingDraftId.value = null
  createForm.value = emptyForm()
  tab.value = 'list'
}

function buildRemark() {
  const parts: string[] = []
  if (createForm.value.warehouseNo.trim()) parts.push(`入仓:${createForm.value.warehouseNo.trim()}`)
  if (createForm.value.plannedDate) parts.push(`到货:${createForm.value.plannedDate}`)
  if (seaFreightTotal.value) {
    const modeLabel = createForm.value.seaFreightMode === 'fcl' ? 'FCL' : 'LCL'
    parts.push(`海运:${modeLabel}/${seaFreightTotal.value}`)
  }
  if (createForm.value.remark.trim()) parts.push(createForm.value.remark.trim())
  return parts.join(' ')
}

async function saveDraft() {
  const draftNo = editingDraftId.value || `DRF-IN-${Date.now().toString().slice(-6)}`
  try {
    await inboundApi.saveDraft({ draftNo, id: draftNo, form: createForm.value })
    editingDraftId.value = draftNo
    await loadDrafts()
    toast('草稿已保存')
    tab.value = 'drafts'
  } catch (e: any) {
    ElMessage.error(e.message || '保存草稿失败')
  }
}

function addMixedCarton() {
  const firstSku = createForm.value.lines.find((l) => l.sku)?.sku || ''
  createForm.value.cartons.push({
    boxCode: '',
    items: [{ sku: firstSku, qty: 1 }],
  })
}

function addCartonLine(carton: CartonForm) {
  carton.items.push({ sku: createForm.value.lines.find((l) => l.sku)?.sku || '', qty: 1 })
}

function syncCartonsOnePerLine() {
  const validLines = createForm.value.lines.filter((l) => l.sku && Number(l.expectedQty) > 0)
  createForm.value.cartons = validLines.map((l) => ({
    boxCode: '',
    items: [{ sku: l.sku, qty: Number(l.expectedQty) }],
  }))
}

function validateCartons(validLines: InboundLine[]) {
  const cartons = createForm.value.cartons.filter((c) => c.items.some((i) => i.sku && i.qty > 0))
  if (!cartons.length) return true
  const expected = new Map<string, number>()
  for (const l of validLines) {
    expected.set(l.sku, (expected.get(l.sku) || 0) + Number(l.expectedQty))
  }
  const packed = new Map<string, number>()
  for (const c of cartons) {
    for (const i of c.items) {
      if (!i.sku || !i.qty) continue
      packed.set(i.sku, (packed.get(i.sku) || 0) + Number(i.qty))
    }
  }
  for (const [sku, qty] of expected) {
    if ((packed.get(sku) || 0) !== qty) {
      ElMessage.warning(`外箱装箱数量与明细不一致：${sku} 装箱 ${packed.get(sku) || 0} ≠ 应收 ${qty}`)
      return false
    }
  }
  return true
}

async function submitCreate() {
  if (!createForm.value.logisticsWhCode) {
    ElMessage.warning('请选择始发物流仓')
    return
  }
  if (!createForm.value.destWarehouseCode) {
    ElMessage.warning('请选择目的海外仓')
    return
  }
  if (!createForm.value.warehouseNo.trim()) {
    ElMessage.warning('请填写入仓号后再提交')
    return
  }
  const validLines = createForm.value.lines.filter((l) => l.sku && Number(l.expectedQty) > 0)
  if (!validLines.length) {
    ElMessage.warning('请至少填写一条 SKU 明细及入库数量')
    return
  }
  const missingDim = validLines.find((l) => !l.lengthCm || !l.widthCm || !l.heightCm)
  if (missingDim) {
    ElMessage.warning(`请填写 SKU「${missingDim.sku}」的单件长、宽、高（cm）`)
    return
  }
  const missingWeight = validLines.find((l) => !l.weightKg)
  if (missingWeight) {
    ElMessage.warning(`请填写 SKU「${missingWeight.sku}」的单件重量（kg）`)
    return
  }
  const skuTotals = new Map<string, number>()
  for (const l of validLines) {
    skuTotals.set(l.sku, (skuTotals.get(l.sku) || 0) + Number(l.expectedQty))
  }
  for (const [sku, total] of skuTotals) {
    const available = getSkuAvailable(sku)
    if (available && total > available) {
      ElMessage.warning(`SKU「${sku}」入库数量合计 ${total} 件，超过本仓可发 ${available} 件`)
      return
    }
  }

  if (!validateCartons(validLines)) return

  const cartonsPayload = createForm.value.cartons
    .filter((c) => c.items.some((i) => i.sku && i.qty > 0))
    .map((c, idx) => ({
      boxCode: c.boxCode.trim() || undefined,
      boxSeq: idx + 1,
      items: c.items.filter((i) => i.sku && i.qty > 0).map((i) => ({ sku: i.sku, qty: Number(i.qty) })),
    }))

  const ok = await withAction(async () => {
    await Promise.all(
      validLines
        .filter((l) => l.productId)
        .map((l) =>
          productApi.update(l.productId, {
            lengthCm: Number(l.lengthCm),
            widthCm: Number(l.widthCm),
            heightCm: Number(l.heightCm),
            weightKg: Number(l.weightKg),
          }).catch(() => {}),
        ),
    )
    productDimMap.value.clear()
    const freightBySku = new Map<string, { unitFreight: number }>()
    for (const fl of freightAllocLines.value) {
      freightBySku.set(fl.sku, { unitFreight: fl.unitFreight || 0 })
    }
    await inboundApi.create({
      inboundNo: createForm.value.inboundNo.trim() || undefined,
      sourceWarehouseCode: createForm.value.logisticsWhCode,
      warehouseCode: createForm.value.destWarehouseCode,
      warehouseNo: createForm.value.warehouseNo.trim(),
      remark: buildRemark(),
      items: validLines.map((l) => ({
        productId: l.productId || undefined,
        sku: l.sku,
        productName: l.productName,
        expectedQty: Number(l.expectedQty),
        remark: l.remark || undefined,
      })),
      cartons: cartonsPayload.length ? cartonsPayload : undefined,
      freightLines: [...skuTotals.entries()].map(([sku, qty]) => {
        const line = validLines.find((l) => l.sku === sku)
        const alloc = freightBySku.get(sku)
        return {
          sku,
          productName: line?.productName,
          inboundQty: qty,
          seaFreightPerUnit: alloc ? Math.round(alloc.unitFreight * 100) / 100 : 0,
          costRmb: line?.unitPrice ? Number(line.unitPrice) : undefined,
        }
      }),
    })
    if (editingDraftId.value) {
      await inboundApi.deleteDraft(editingDraftId.value).catch(() => {})
      await loadDrafts()
    }
    await load()
  }, '入库单已创建，海运费已自动同步至货盘库存')

  if (ok) {
    editingDraftId.value = null
    createForm.value = emptyForm()
    tab.value = 'list'
  }
}

function detail(row: any) {
  showDetail(`入库单 · ${row.id}`, [
    ['入库单号', row.id],
    ['入仓号', row.warehouseNo || '—'], ['目的仓', row.warehouse], ['SKU', row.sku],
    ['总数量', row.qty.toLocaleString()], ['总立方', row.cbm !== '—' ? `${row.cbm} m³` : '—'],
    ['预计到货', row.arrival || '—'], ['状态', row.statusLabel], ['创建时间', row.time],
    ['备注', row.displayRemark],
  ])
}

async function downloadLabel(row: any) {
  const id = row._raw?.id
  if (!id) return
  try {
    const { blob, fileName } = await inboundApi.downloadSkuLabel(id)
    triggerBlobDownload(blob, fileName)
    toast(`已下载 ${row.id} SKU 标签`)
  } catch (e: any) {
    ElMessage.error(e.message || '标签下载失败')
  }
}

async function downloadOuterLabel(row: any) {
  const id = row._raw?.id
  if (!id) return
  try {
    const { blob, fileName } = await inboundApi.downloadOuterLabel(id)
    triggerBlobDownload(blob, fileName)
    toast(`已下载 ${row.id} 外箱标`)
  } catch (e: any) {
    ElMessage.error(e.message || '外箱标下载失败')
  }
}

function editDraft(row: any) {
  editingDraftId.value = row.id
  createForm.value = JSON.parse(JSON.stringify(row._form))
  tab.value = 'form'
  if (createForm.value.logisticsWhCode) loadLogisticsStock(createForm.value.logisticsWhCode)
}

async function deleteDraft(row: any) {
  if (await confirmAction(`确认删除草稿 ${row.id}？`, '删除草稿')) {
    try {
      await inboundApi.deleteDraft(row.id)
      await loadDrafts()
      toast('草稿已删除')
    } catch (e: any) {
      ElMessage.error(e.message || '删除失败')
    }
  }
}

function onAttachmentPick() {
  attachmentInputRef.value?.click()
}

async function handleAttachmentFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    bytes.forEach((b) => { binary += String.fromCharCode(b) })
    const contentBase64 = btoa(binary)
    await inboundApi.uploadAttachment({
      draftNo: editingDraftId.value || undefined,
      fileName: file.name,
      contentBase64,
    })
    toast(`附件「${file.name}」已上传`)
  } catch (err: any) {
    ElMessage.error(err.message || '附件上传失败')
  }
}
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">创建入库单</span>
        <el-button type="primary" size="small" @click="openCreate">新建入库单</el-button>
      </div>
    </template>

    <div class="callout info">
      <div class="callout-title">国内中转仓 → 海外仓发货</div>
      <div class="callout-body">
        {{ PIPELINE_INBOUND_CALLOUT }} 供应商送货、中转仓收货请在「物流中转仓」完成；货物到海外仓后的扫描、收货、上架请在「海外仓作业」模块处理。</div>
    </div>

    <div class="tab-pills">
      <button type="button" class="pill" :class="{ active: tab === 'form' }" @click="tab = 'form'">新建入库单</button>
      <button type="button" class="pill" :class="{ active: tab === 'drafts' }" @click="tab = 'drafts'">
        草稿箱<span v-if="drafts.length"> ({{ drafts.length }})</span>
      </button>
      <button type="button" class="pill" :class="{ active: tab === 'list' }" @click="tab = 'list'">入库单管理</button>
    </div>

    <!-- 新建入库单 -->
    <div v-if="tab === 'form'" v-loading="createLoading" class="form-panel">
      <div class="form-card">
        <div class="form-card-header">
          <span>{{ editingDraftId ? `编辑草稿 · ${editingDraftId}` : '新建入库单' }}</span>
          <el-tag size="small" :type="editingDraftId ? 'info' : 'warning'">{{ editingDraftId ? '草稿' : '未保存' }}</el-tag>
        </div>

        <section class="form-section">
          <div class="section-title">基本信息</div>
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="入库单号">
                <el-input v-model="createForm.inboundNo" placeholder="如 IN-2026-0413，留空自动生成" clearable />
                <p class="field-hint">默认系统自动生成，可直接修改；提交后不可变更</p>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="操作员">
                <el-input :model-value="app.currentAccount.name" readonly />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="始发中转仓" required>
                <el-select v-model="createForm.logisticsWhCode" placeholder="选择物流中转仓" filterable style="width:100%">
                  <el-option
                    v-for="wh in logisticsWarehouses"
                    :key="wh.warehouseCode"
                    :label="`${wh.warehouseName} · ${wh.city || ''}`"
                    :value="wh.warehouseCode"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="目的海外仓">
                <el-select v-model="createForm.destWarehouseCode" style="width:100%">
                  <el-option
                    v-for="wh in overseasWarehouses"
                    :key="wh.warehouseCode"
                    :label="`${wh.warehouseName} (${wh.warehouseCode})`"
                    :value="wh.warehouseCode"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="预计到货">
                <el-date-picker v-model="createForm.plannedDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="入仓号" required>
                <el-input v-model="createForm.warehouseNo" placeholder="如 WH-JHB-A12" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="总立方数 (m³)">
                <el-input :model-value="volumeTotals.cbm" readonly class="mono-input" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="总重量(kg)">
                <el-input :model-value="volumeTotals.weight" readonly class="mono-input" />
              </el-form-item>
            </el-col>
          </el-row>
        </section>

        <!-- 海运费用分摊 -->
        <section class="form-section">
          <div class="section-title">海运费用分摊</div>
          <p class="section-desc">选择运输方式并填写本票海运费总额，系统按各行 SKU 体积占比自动分摊到每个 SKU 及单件运费</p>
          <div class="sea-mode-row">
            <el-radio-group v-model="createForm.seaFreightMode" size="small">
              <el-radio-button value="lcl">拼柜 (LCL)</el-radio-button>
              <el-radio-button value="fcl">整柜 (FCL)</el-radio-button>
            </el-radio-group>
          </div>
          <el-row :gutter="20">
            <el-col :span="8">
              <el-form-item v-if="createForm.seaFreightMode === 'lcl'" label="拼柜海运费(RMB)">
                <el-input
                  v-model="createForm.seaFreightAmounts.lcl"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="填写拼柜海运费总额"
                />
              </el-form-item>
              <el-form-item v-else label="整柜海运费(RMB)">
                <el-input
                  v-model="createForm.seaFreightAmounts.fcl"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="填写整柜海运费总额"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="当前分摊基数">
                <el-input
                  :model-value="seaFreightTotal ? `${createForm.seaFreightMode === 'fcl' ? '整柜' : '拼柜'} · ${formatMoney(seaFreightTotal)}` : '未填写'"
                  readonly
                  class="mono-input"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="分摊总立方(m³)">
                <el-input :model-value="volumeTotals.cbm" readonly class="mono-input" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-alert
            v-if="seaFreightTotal && missingDimSkus.length"
            type="warning"
            :closable="false"
            show-icon
            class="alloc-hint"
            :title="`请在下方 SKU 明细中填写 ${missingDimSkus.join('、')} 的单件长、宽、高（cm），才能计算体积分摊`"
          />
          <div v-if="seaFreightTotal && freightAllocLines.length" class="alloc-panel">
            <div class="alloc-panel-head">
              <div class="alloc-panel-title">
                <span class="alloc-mode-tag">{{ createForm.seaFreightMode === 'fcl' ? '整柜 FCL' : '拼柜 LCL' }}</span>
                <span>海运费分摊明细</span>
              </div>
              <div class="alloc-panel-meta">
                <span>总额 <strong class="num">{{ formatMoney(seaFreightTotal) }}</strong></span>
                <span class="meta-divider">|</span>
                <span>总体积<strong class="num">{{ volumeTotals.cbm }} m³</strong></span>
                <span class="meta-divider">|</span>
                <span>{{ freightAllocLines.length }} 个 SKU</span>
              </div>
            </div>
            <div class="alloc-grid">
              <div class="alloc-grid-head">
                <span>SKU</span>
                <span class="align-right">行体积(m³)</span>
                <span class="align-right">体积占比</span>
                <span class="align-right">分摊海运费</span>
                <span class="align-right">单件海运费</span>
              </div>
              <div v-for="row in freightAllocLines" :key="row.sku" class="alloc-grid-row">
                <span class="sku-code">{{ row.sku }}</span>
                <span class="num align-right">{{ row.lineCbm ? row.lineCbm.toFixed(3) : '—' }}</span>
                <span class="align-right">
                  <span v-if="row.lineCbm" class="pct-badge">{{ row.volumePct.toFixed(1) }}%</span>
                  <span v-else class="num muted">—</span>
                </span>
                <span class="num money align-right">{{ row.lineFreight ? formatMoney(row.lineFreight) : '—' }}</span>
                <span class="num align-right">{{ row.unitFreight ? formatMoney(row.unitFreight) : '—' }}</span>
              </div>
            </div>
            <p v-if="seaFreightTotal && !canCalcFreight" class="alloc-empty-hint">
              分摊明细待计算：请先在 SKU 明细中填写各行的长、宽、高（cm）。
            </p>
          </div>
        </section>

        <!-- SKU 明细 -->
        <section class="form-section">
          <div class="section-head">
            <div class="section-title">入库 SKU 明细（从本仓可发库存选择）</div>
            <div class="section-actions">
              <el-button size="small" link type="primary" @click="downloadSkuTemplate">下载模板</el-button>
              <el-button size="small" :disabled="!createForm.logisticsWhCode" @click="triggerSkuImport">导入文件</el-button>
              <el-button type="primary" size="small" :disabled="!createForm.logisticsWhCode" @click="addLine">+ 添加 SKU</el-button>
            </div>
          </div>
          <input ref="skuFileInputRef" type="file" accept=".csv,.xls,.txt" style="display:none" @change="handleSkuImportFile" />
          <input ref="attachmentInputRef" type="file" style="display:none" @change="handleAttachmentFile" />
          <p v-if="createForm.logisticsWhCode" class="sku-hint">
            仅展示当前中转仓<strong>已收货</strong>且可用库存 &gt; 0 的 SKU；无选项时请先到「物流中转仓」登记 PO 收货。
            当前可发 SKU <strong>{{ warehouseSkus.length }}</strong> 个
            <span v-if="skuLoading">（加载中…）</span>
            · 选择 SKU 后请填写<strong>单件长、宽、高（cm）</strong>、<strong>重量（kg）</strong>；入库数量不可超过本仓可发库存
            · 表格列较多时可<strong>横向滚动</strong>查看尺寸与海运费分摊
          </p>
          <div v-if="createForm.lines.length" class="lines-table-wrap">
          <el-table v-loading="skuLoading" :data="createForm.lines" border size="small" class="lines-table">
            <el-table-column label="SKU" min-width="200" fixed="left">
              <template #default="{ row }">
                <el-select
                  v-model="row.sku"
                  filterable
                  :fit-input-width="false"
                  popper-class="inbound-sku-select-popper"
                  placeholder="选择 SKU"
                  size="small"
                  style="width:100%"
                  @change="(v: string) => onLineSkuPick(row, v)"
                >
                  <el-option
                    v-for="s in warehouseSkus"
                    :key="s.sku"
                    :label="skuOptionLabel(s)"
                    :value="s.sku"
                  >
                    <div class="sku-option-row">
                      <span class="mono sku-option-code">{{ s.sku }}</span>
                      <span class="sku-option-name">{{ s.productName || '—' }}</span>
                      <span class="sku-option-qty">可发 {{ s.available }}</span>
                    </div>
                  </el-option>
                </el-select>
              </template>
            </el-table-column>
            <el-table-column prop="productName" label="商品名" min-width="140" show-overflow-tooltip />
            <el-table-column label="入库数量" width="148" align="center">
              <template #default="{ row }">
                <div class="num-cell">
                  <el-input-number
                    v-model="row.expectedQty"
                    :min="1"
                    :max="getLineMaxQty(row)"
                    size="small"
                    controls-position="right"
                    class="line-num-input"
                    @change="(v: number | undefined) => clampLineQty(row, v)"
                  />
                  <span v-if="row.sku" class="qty-cap-hint">可发 {{ getSkuAvailable(row.sku) }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="长(cm)" width="128" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.lengthCm" :min="0" :precision="1" :step="0.1" size="small" controls-position="right" class="line-num-input" placeholder="长" />
              </template>
            </el-table-column>
            <el-table-column label="宽(cm)" width="128" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.widthCm" :min="0" :precision="1" :step="0.1" size="small" controls-position="right" class="line-num-input" placeholder="宽" />
              </template>
            </el-table-column>
            <el-table-column label="高(cm)" width="128" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.heightCm" :min="0" :precision="1" :step="0.1" size="small" controls-position="right" class="line-num-input" placeholder="高" />
              </template>
            </el-table-column>
            <el-table-column label="重量(kg)" width="128" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.weightKg" :min="0" :precision="3" :step="0.01" size="small" controls-position="right" class="line-num-input" placeholder="重量" />
              </template>
            </el-table-column>
            <el-table-column label="行备注" min-width="100">
              <template #default="{ row }">
                <el-input v-model="row.remark" size="small" placeholder="可选" clearable />
              </template>
            </el-table-column>
            <el-table-column label="单件立方" width="95">
              <template #default="{ row }">{{ formatCubic(row.lengthCm, row.widthCm, row.heightCm) }}</template>
            </el-table-column>
            <el-table-column label="行体积(m³)" width="95" align="right">
              <template #default="{ row }"><span class="mono">{{ calculateLineCbm(row) ? calculateLineCbm(row).toFixed(4) : '—' }}</span></template>
            </el-table-column>
            <el-table-column label="体积占比" width="85" align="right">
              <template #default="{ row }"><span class="mono">{{ volumePctLabel(row.sku) }}</span></template>
            </el-table-column>
            <el-table-column label="分摊海运费" width="100" align="right">
              <template #default="{ row }"><span class="mono">{{ freightLabel(row.sku, 'lineFreight') }}</span></template>
            </el-table-column>
            <el-table-column label="单件海运费" width="100" align="right">
              <template #default="{ row }"><span class="mono">{{ freightLabel(row.sku, 'unitFreight') }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="60" align="center" fixed="right">
              <template #default="{ $index }">
                <el-button link type="danger" size="small" @click="removeLine($index)">移除</el-button>
              </template>
            </el-table-column>
          </el-table>
          </div>
          <el-empty v-else :description="createForm.logisticsWhCode ? '点击「+ 添加 SKU」从本仓可发库存选择' : '请先选择始发物流仓'" :image-size="64" />

          <div class="inbound-summary">
            <span>预期入库总量：<strong>{{ totalExpectedQty.toLocaleString() }}</strong> 件</span>
            <span v-if="totalAmount">货值合计：<strong class="total-amt">{{ formatMoney(totalAmount) }}</strong></span>
          </div>
        </section>

        <section v-if="createForm.lines.length" class="form-section">
          <div class="section-head">
            <div class="section-title">外箱装箱（每箱一张外箱标，扫箱收货时自动识别）</div>
            <div class="section-actions">
              <el-button size="small" @click="syncCartonsOnePerLine">每 SKU 一箱</el-button>
              <el-button size="small" type="primary" @click="addMixedCarton">添加混装箱</el-button>
            </div>
          </div>
          <p class="sku-hint">
            留空则提交后按每个 SKU 一行自动生成外箱（箱码如 IN-xxx-C001）。混装请配置每箱 SKU 与数量，须与上方明细总数一致。
          </p>
          <el-table v-if="createForm.cartons.length" :data="createForm.cartons" border size="small" class="lines-table">
            <el-table-column label="#" width="50" align="center">
              <template #default="{ $index }">{{ $index + 1 }}</template>
            </el-table-column>
            <el-table-column label="箱码（可选）" width="180">
              <template #default="{ row }">
                <el-input v-model="row.boxCode" size="small" placeholder="留空自动生成" />
              </template>
            </el-table-column>
            <el-table-column label="箱内 SKU / 数量" min-width="320">
              <template #default="{ row }">
                <div v-for="(line, li) in row.items" :key="li" class="carton-line-row">
                  <el-select v-model="line.sku" filterable size="small" style="width:140px" placeholder="SKU">
                    <el-option
                      v-for="l in createForm.lines.filter(x => x.sku)"
                      :key="l.sku"
                      :label="l.sku"
                      :value="l.sku"
                    />
                  </el-select>
                  <el-input-number v-model="line.qty" :min="1" size="small" controls-position="right" style="width:100px;margin-left:6px" />
                  <el-button v-if="row.items.length > 1" link type="danger" size="small" @click="row.items.splice(li, 1)">删</el-button>
                </div>
                <el-button link type="primary" size="small" @click="addCartonLine(row)">+ SKU</el-button>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70" align="center">
              <template #default="{ $index }">
                <el-button link type="danger" size="small" @click="createForm.cartons.splice($index, 1)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="form-section">
          <el-form-item label="备注">
            <el-input v-model="createForm.remark" type="textarea" :rows="2" placeholder="收货说明、优先级等" />
          </el-form-item>
          <el-form-item label="附件">
            <div class="upload-zone" @click="onAttachmentPick">
              点击上传或拖拽文件 · 支持装箱单、质检报告（PDF / XLSX）            </div>
          </el-form-item>
        </section>

        <div class="form-footer">
          <el-button
            type="primary"
            :disabled="!canCreateInbound"
            :title="canCreateInbound ? '' : '当前角色无创建权限'"
            @click="submitCreate"
          >
            提交入库单</el-button>
          <el-button @click="saveDraft">保存草稿</el-button>
          <el-button @click="cancelForm">取消</el-button>
        </div>
      </div>

    </div>

    <!-- 草稿箱 -->
    <template v-else-if="tab === 'drafts'">
      <el-table :data="draftPagedItems" stripe border size="small">
        <el-table-column prop="id" label="草稿编号" width="130">
          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column label="计划入库单号" width="140">
          <template #default="{ row }">
            <span v-if="row._form.inboundNo" class="mono">{{ row._form.inboundNo }}</span>
            <span v-else class="text-muted">待填写</span>
          </template>
        </el-table-column>
        <el-table-column label="入仓号" width="110">
          <template #default="{ row }">{{ row._form.warehouseNo || '—' }}</template>
        </el-table-column>
        <el-table-column prop="sku" label="SKU" min-width="130" />
        <el-table-column prop="qty" label="数量" width="80" align="right" />
        <el-table-column label="预计到货" width="110">
          <template #default="{ row }">{{ row._form.plannedDate || '—' }}</template>
        </el-table-column>
        <el-table-column prop="savedAt" label="保存时间" width="150" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="editDraft(row)">继续编辑</el-button>
            <el-button link type="danger" size="small" @click="deleteDraft(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!drafts.length" description="暂无草稿，填写信息后点击「保存草稿」" />
      <ListPagination v-model:page="draftPage" v-model:page-size="draftPageSize" :total="draftTotal" />
      <p class="text-muted footer-note">草稿保存在浏览器本地，提交后将转为正式入库单并从草稿箱移除</p>
    </template>

    <!-- 入库单管理 -->
    <template v-else>
      <div class="list-kpi-row">
        <div class="kpi"><strong>{{ listStats.total }}</strong><span>有效入库单</span></div>
        <div class="kpi warn"><strong>{{ listStats.pendingReceipt }}</strong><span>待收货</span></div>
        <div class="kpi"><strong>{{ listStats.pendingPutaway }}</strong><span>待上架</span></div>
        <div class="kpi ok"><strong>{{ listStats.completed }}</strong><span>已入库</span></div>
        <div class="kpi"><strong>{{ listStats.cbm !== '—' ? `约 ${listStats.cbm}m³` : '—' }}</strong><span>在途总立方</span></div>
        <span class="spacer" />
        <el-input v-model="inboundSearchQ" placeholder="入库单 / SKU" clearable style="width:160px;margin-left:8px" />
      </div>
      <el-table v-loading="loading" :data="inboundPagedItems" stripe border size="small">
        <el-table-column prop="id" label="入库单号" width="130">
          <template #default="{ row }"><span class="mono">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column label="入仓号" width="110">
          <template #default="{ row }">{{ row.warehouseNo || '—' }}</template>
        </el-table-column>
        <el-table-column prop="sku" label="SKU" min-width="130" />
        <el-table-column prop="qty" label="数量" width="80" align="right">
          <template #default="{ row }">{{ row.qty.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="总立方数" width="100" align="right">
          <template #default="{ row }"><span class="mono">{{ row.cbm !== '—' ? `约 ${row.cbm}m³` : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="预计到货" width="100">
          <template #default="{ row }">{{ row.arrival || '—' }}</template>
        </el-table-column>
        <el-table-column label="备注" min-width="100">
          <template #default="{ row }">{{ row.displayRemark }}</template>
        </el-table-column>
        <el-table-column prop="statusLabel" label="状态" width="95">
          <template #default="{ row }">
            <el-tag :type="row.tone === 'ok' ? 'success' : row.tone === 'err' ? 'danger' : row.tone === 'warn' ? 'warning' : 'info'" size="small">{{ row.statusLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
            <el-button link type="primary" size="small" @click="downloadLabel(row)">标签</el-button>
            <el-button link type="primary" size="small" @click="downloadOuterLabel(row)">外箱标</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !filteredInbounds.length" description="暂无入库单，点击「新建入库单」开始创建" />
      <ListPagination v-model:page="inboundPage" v-model:page-size="inboundPageSize" :total="inboundTotal" />
      <p class="text-muted footer-note">入库单创建后进入待收货；仓库在「到仓扫描」完成收货、清点与上架。可下载 SKU 标签与外箱标。</p>
    </template>
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }

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

.tab-pills {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.pill {
  padding: 6px 16px;
  border: 1px solid #d4cbb8;
  border-radius: 20px;
  background: #fff;
  font-size: 13px;
  cursor: pointer;
  color: #5c5348;
}
.pill.active {
  background: #1f9d92;
  border-color: #1f9d92;
  color: #fff;
}

.form-panel { display: flex; flex-direction: column; gap: 16px; }
.form-card {
  border: 1px solid #ece6dd;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.form-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-bottom: 1px solid #ece6dd;
  font-weight: 600;
  background: #faf8f4;
}

.form-section {
  padding: 16px 20px;
  border-bottom: 1px solid #f0ebe3;
}
.section-title { font-weight: 600; font-size: 14px; color: #2b2b2b; margin-bottom: 12px; }
.section-subtitle { font-weight: 600; font-size: 13px; margin-bottom: 8px; color: #5c5348; }
.section-desc { font-size: 12px; color: #8b95a8; margin: -6px 0 12px; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.section-head .section-title { margin-bottom: 0; }
.section-actions { display: flex; gap: 8px; }

.field-hint { font-size: 11px; color: #8b95a8; margin: 4px 0 0; }
.mono-input :deep(.el-input__inner) { font-family: var(--font-mono, Consolas, monospace); }

.po-derived {
  display: flex;
  gap: 24px;
  padding: 10px 14px;
  background: #fff;
  border: 1px dashed #d4cbb8;
  border-radius: 6px;
  font-size: 13px;
  color: #5c5348;
  margin-top: 4px;
}

.sea-mode-row { margin-bottom: 12px; }
.alloc-hint { margin-bottom: 12px; }
.alloc-empty-hint {
  margin: 0;
  padding: 10px 16px;
  font-size: 12px;
  color: #b45309;
  background: #fffbeb;
  border-top: 1px solid #fde68a;
}

.alloc-panel {
  margin-top: 16px;
  border: 1px solid #e8e2d8;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.alloc-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: linear-gradient(180deg, #faf7f2 0%, #fff 100%);
  border-bottom: 1px solid #ece6dd;
}
.alloc-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: #2b2b2b;
}
.alloc-mode-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: #1f9d92;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.alloc-panel-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #6b6560;
}
.alloc-panel-meta strong { color: #2b2b2b; font-weight: 600; }
.meta-divider { color: #d4cbb8; user-select: none; }

.alloc-grid {
  width: 100%;
}
.alloc-grid-head,
.alloc-grid-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.4fr) minmax(96px, 1fr) minmax(88px, 0.9fr) minmax(112px, 1.1fr) minmax(104px, 1fr);
  gap: 8px 12px;
  align-items: center;
  padding: 10px 16px;
}
.alloc-grid-head {
  background: #f5f0e8;
  color: #5c5348;
  font-weight: 600;
  font-size: 12px;
  border-bottom: 1px solid #ece6dd;
}
.alloc-grid-row {
  font-size: 13px;
  color: #2b2b2b;
  border-bottom: 1px solid #f0ebe3;
}
.alloc-grid-row:last-child {
  border-bottom: none;
}
.alloc-grid-row:nth-child(even) {
  background: #faf8f4;
}
.align-right {
  text-align: right;
  justify-self: end;
}

.sku-code {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  color: #3d4f63;
}
.num {
  font-family: var(--font-mono, Consolas, monospace);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.num.money { color: #1f9d92; font-weight: 600; }
.num.muted { color: #b0a89c; }
.pct-badge {
  display: inline-block;
  min-width: 52px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #eef6ff;
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.sku-hint { font-size: 12px; color: #8b95a8; margin: 0 0 10px; }
.lines-table-wrap {
  overflow-x: auto;
  margin-bottom: 4px;
}
.lines-table { width: 100%; min-width: 1580px; }
.num-cell { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.qty-cap-hint { font-size: 11px; color: #a39a8c; line-height: 1.2; }
.lines-table :deep(.line-num-input) { width: 100%; min-width: 112px; }
.lines-table :deep(.line-num-input .el-input__wrapper) { padding-left: 8px; padding-right: 36px; }
.lines-table :deep(.line-num-input .el-input__inner) { text-align: left; min-width: 64px; }
.lines-table :deep(.el-table__cell) { padding: 8px 6px; }
.inbound-sku-select-popper { min-width: 420px !important; }
.sku-option-row {
  display: grid;
  grid-template-columns: minmax(96px, auto) minmax(120px, 1fr) auto;
  gap: 8px;
  align-items: center;
  line-height: 1.4;
}
.sku-option-code { font-weight: 600; color: #2b2b2b; }
.sku-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #5c5348;
  font-size: 12px;
}
.sku-option-qty { color: #8b95a8; font-size: 12px; white-space: nowrap; }
.carton-line-row { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; flex-wrap: wrap; }

.inbound-summary {
  display: flex;
  gap: 28px;
  justify-content: flex-end;
  padding: 12px 0 0;
  font-size: 13px;
}
.total-amt { color: #1f9d92; }

.upload-zone {
  border: 1px dashed #d4cbb8;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  color: #8b95a8;
  font-size: 13px;
  cursor: pointer;
  background: #faf8f4;
}
.upload-zone:hover { border-color: #1f9d92; color: #1f9d92; }

.form-footer {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #ece6dd;
  background: #faf8f4;
}

.ref-section { margin-top: 4px; }

.list-kpi-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 16px;
  background: #faf8f4;
  border: 1px solid #ece6dd;
  border-radius: 8px;
  min-width: 90px;
}
.kpi strong { font-size: 18px; color: #2b2b2b; }
.kpi span { font-size: 11px; color: #8b95a8; }
.kpi.ok strong { color: #1f9d92; }
.kpi.err strong { color: #e85d5d; }
.spacer { flex: 1; }

.mono { font-family: var(--font-mono, Consolas, monospace); font-size: 12px; }
.link { color: #2563eb; }
.text-muted { color: #8b95a8; font-size: 12px; }
.footer-note { margin-top: 10px; }

:deep(.form-section .el-form-item) { margin-bottom: 12px; }
:deep(.form-section .el-form-item__label) { font-size: 13px; color: #5c5348; }
</style>
