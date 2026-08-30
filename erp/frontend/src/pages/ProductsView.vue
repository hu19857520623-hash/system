<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { erpConfirm } from '@/utils/messageBox'
import type { TableInstance } from 'element-plus'
import { productApi, asyncIoApi, supplierApi, usersApi } from '@/api/client.js'
import { mapProduct } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'
import { useAsyncIo } from '@/composables/useAsyncIo'
import { downloadProductImportTemplate } from '@/constants/importTemplates.ts'
import { printProductSkuLabels } from '@/features/labels/productLabelPrint.ts'

const app = useAppStore()
const canPrintLabel = computed(() => app.hasPerm('products.print_label'))
const { importCsv } = useAsyncIo()
const route = useRoute()

function productImageSrc(url: string | undefined | null) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('/api/')) return url
  return `/api${url.startsWith('/') ? url : `/${url}`}`
}

const filter = ref('all')
const skuQ = ref('')
const nameQ = ref('')
const tableRef = ref<TableInstance>()
const selectedRows = ref<any[]>([])

const EXPORT_HEADERS = ['SKU', 'SPU', '商品名称', '规格', '采购成本(RMB)', '海运/件(RMB)', '综合成本(RMB)', '长(cm)', '宽(cm)', '高(cm)', '重量(kg)', '条码', '状态']

const { loading, items: products, load } = useListLoader(async () => {
  const res = await productApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(mapProduct), total: res.total }
})

onMounted(() => {
  load()
  loadCreateOptions()
  const editId = route.query.edit
  if (editId) openEdit(Number(editId))
})

const filters = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '已生效' },
  { id: 'inactive', label: '已停用' },
]

const filtered = computed(() => {
  return products.value.filter(p => {
    if (filter.value === 'active' && p.statusKey !== 'active') return false
    if (filter.value === 'inactive' && p.statusKey !== 'inactive') return false
    if (skuQ.value && !p.sku.toLowerCase().includes(skuQ.value.toLowerCase())) return false
    if (nameQ.value && !p.name.toLowerCase().includes(nameQ.value.toLowerCase())) return false
    return true
  })
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(filtered)
watch([filter, skuQ, nameQ], resetPage)

function onSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

function selectAll() {
  filtered.value.forEach((row) => tableRef.value?.toggleRowSelection(row, true))
}

function clearSelection() {
  tableRef.value?.clearSelection()
}

function escapeCsv(val: unknown) {
  const s = String(val ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function productToRow(p: any) {
  return [p.sku, p.spu, p.name, p.spec, p.purchaseCost, p.seaFreight, p.totalCost || p.cost, p.length, p.width, p.height, p.weight, p.barcode, p.status]
}

function formatMoney(val: string | number | undefined | null) {
  const n = Number(val)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const bom = '\uFEFF'
  const content = bom + [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function importProducts() {
  const job = await importCsv('商品主数据')
  if (job) await load()
}

async function exportSelected() {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选要导出的商品，或点击「全选」')
    return
  }
  const filename = `商品主数据_${new Date().toISOString().slice(0, 10)}.csv`
  downloadCsv(filename, EXPORT_HEADERS, selectedRows.value.map(productToRow))
  try {
    await asyncIoApi.create({
      jobType: 'export',
      module: '商品主数据',
      fileName: filename,
      totalRows: selectedRows.value.length,
    })
  } catch { /* 记录失败不影响下载 */ }
  ElMessage.success(`已导出 ${selectedRows.value.length} 条商品，可在「异步导出导入」查看任务记录`)
}

const dialogVisible = ref(false)
const createVisible = ref(false)
const createSaving = ref(false)
const detailVisible = ref(false)
const editingProduct = ref<any>(null)
const detailProduct = ref<any>(null)
const imageUploading = ref(false)

const MAX_PRODUCT_IMAGES = 20

const supplierOptions = ref<{ id: number; label: string }[]>([])
const purchaserOptions = ref<{ id: number; label: string }[]>([])
const developerOptions = ref<{ id: number; label: string }[]>([])

const STATUS_OPTIONS = [
  { value: 'active', label: '已生效' },
  { value: 'pending', label: '待完善主数据' },
  { value: 'inactive', label: '已停用' },
]

function emptyCreateForm() {
  return {
    sku: '',
    spu: '',
    productName: '',
    spec: '',
    costRmb: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    weightKg: '',
    barcode: '',
    developerId: null as number | null,
    purchaserId: null as number | null,
    supplierId: null as number | null,
    status: 'active',
  }
}

const createForm = ref(emptyCreateForm())

async function loadCreateOptions() {
  try {
    const [supRes, purchaserRes, devRes, devMgrRes] = await Promise.all([
      supplierApi.list({ pageSize: 200 }),
      usersApi.list({ roleCode: 'purchaser', pageSize: 100 }),
      usersApi.list({ roleCode: 'viewer', pageSize: 100 }),
      usersApi.list({ roleCode: 'dev_manager', pageSize: 100 }),
    ])
    supplierOptions.value = (supRes.items || []).map((s: any) => ({
      id: s.id,
      label: s.supplierName || s.name || `#${s.id}`,
    }))
    purchaserOptions.value = (purchaserRes.items || []).map((u: any) => ({
      id: u.id,
      label: u.realName || u.username,
    }))
    const devMap = new Map<number, string>()
    ;[...(devRes.items || []), ...(devMgrRes.items || [])].forEach((u: any) => {
      devMap.set(u.id, u.realName || u.username)
    })
    developerOptions.value = [...devMap.entries()].map(([id, label]) => ({ id, label }))
  } catch {
    supplierOptions.value = []
    purchaserOptions.value = []
    developerOptions.value = []
  }
}

function openCreate() {
  createForm.value = emptyCreateForm()
  if (!supplierOptions.value.length) loadCreateOptions()
  createVisible.value = true
}

async function saveCreate() {
  const f = createForm.value
  if (!f.sku.trim()) {
    ElMessage.warning('请填写 SKU')
    return
  }
  if (!f.productName.trim()) {
    ElMessage.warning('请填写商品名称')
    return
  }
  createSaving.value = true
  try {
    const created = await productApi.create({
      sku: f.sku.trim(),
      spu: f.spu.trim() || undefined,
      productName: f.productName.trim(),
      spec: f.spec.trim() || undefined,
      costRmb: f.costRmb !== '' ? Number(f.costRmb) : 0,
      lengthCm: f.lengthCm !== '' ? Number(f.lengthCm) : undefined,
      widthCm: f.widthCm !== '' ? Number(f.widthCm) : undefined,
      heightCm: f.heightCm !== '' ? Number(f.heightCm) : undefined,
      weightKg: f.weightKg !== '' ? Number(f.weightKg) : undefined,
      barcode: f.barcode.trim() || undefined,
      developerId: f.developerId || undefined,
      purchaserId: f.purchaserId || undefined,
      supplierId: f.supplierId || undefined,
      status: f.status,
    })
    createVisible.value = false
    ElMessage.success(`商品 ${created.sku} 已创建，可在编辑中上传图片`)
    await load()
    if (created.id) openEdit(created.id)
  } catch (err: any) {
    ElMessage.error(err.message || '创建失败')
  } finally {
    createSaving.value = false
  }
}

function applyProductImages(target: any, product: any) {
  target.images = product.images || []
  target.imageUrls = product.imageUrls || []
  target.imageUrl = product.imageUrl || target.imageUrls[0] || ''
  target.imageCount = target.imageUrls.length
}

function openEdit(id: number) {
  if (!supplierOptions.value.length) loadCreateOptions()
  loadProductDialog(id, 'edit')
}

async function loadProductDialog(id: number, mode: 'detail' | 'edit') {
  try {
    const res = await productApi.detail(id)
    const mapped = mapProduct(res)
    mapped.developerId = res.developerId ?? null
    mapped.purchaserId = res.purchaserId ?? null
    mapped.supplierId = res.supplierId ?? null
    if (mode === 'detail') {
      detailProduct.value = mapped
      detailVisible.value = true
    } else {
      editingProduct.value = mapped
      dialogVisible.value = true
    }
  } catch (err: any) {
    ElMessage.error(err.message || '加载商品失败')
  }
}

async function saveProduct() {
  if (!editingProduct.value?.id) return
  const ok = await withAction(async () => {
    await productApi.update(editingProduct.value.id, {
      productName: editingProduct.value.name,
      spu: editingProduct.value.spu,
      spec: editingProduct.value.spec,
      costRmb: Number(editingProduct.value.purchaseCost || editingProduct.value.cost) || 0,
      lengthCm: Number(editingProduct.value.length) || undefined,
      widthCm: Number(editingProduct.value.width) || undefined,
      heightCm: Number(editingProduct.value.height) || undefined,
      weightKg: Number(editingProduct.value.weight) || undefined,
      barcode: editingProduct.value.barcode,
      developerId: editingProduct.value.developerId || undefined,
      purchaserId: editingProduct.value.purchaserId || undefined,
      supplierId: editingProduct.value.supplierId || undefined,
    })
  }, '商品已更新')
  if (ok) {
    dialogVisible.value = false
    load()
  }
}

function openDetail(id: number) {
  loadProductDialog(id, 'detail')
}

function productPreviewList(urls: string[] | undefined) {
  return (urls || []).map((url) => productImageSrc(url))
}

async function uploadProductImage(productId: number, file: File) {
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请上传图片文件')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 5MB')
    return
  }
  const currentCount = detailProduct.value?.id === productId
    ? detailProduct.value.imageCount
    : editingProduct.value?.id === productId
      ? editingProduct.value.imageCount
      : products.value.find((p) => p.id === productId)?.imageCount || 0
  if (currentCount >= MAX_PRODUCT_IMAGES) {
    ElMessage.warning(`最多上传 ${MAX_PRODUCT_IMAGES} 张图片`)
    return
  }
  imageUploading.value = true
  try {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    bytes.forEach((b) => { binary += String.fromCharCode(b) })
    const contentBase64 = btoa(binary)
    const res = await productApi.uploadImage(productId, { fileName: file.name, contentBase64 })
    const product = res.product || res
    if (detailProduct.value?.id === productId) applyProductImages(detailProduct.value, mapProduct(product))
    if (editingProduct.value?.id === productId) applyProductImages(editingProduct.value, mapProduct(product))
    ElMessage.success('图片已上传')
    load()
  } catch (err: any) {
    ElMessage.error(err.message || '图片上传失败')
  } finally {
    imageUploading.value = false
  }
}

async function removeProductImage(productId: number, imageId: number | null) {
  if (!imageId) {
    ElMessage.warning('请打开详情后删除该图片')
    return
  }
  try {
    await erpConfirm('确认删除这张图片？', '删除图片', { type: 'warning' })
    const res = await productApi.deleteImage(productId, imageId)
    const product = res.product || res
    if (detailProduct.value?.id === productId) applyProductImages(detailProduct.value, mapProduct(product))
    if (editingProduct.value?.id === productId) applyProductImages(editingProduct.value, mapProduct(product))
    ElMessage.success('图片已删除')
    load()
  } catch (err: any) {
    if (err !== 'cancel') ElMessage.error(err.message || '删除失败')
  }
}

async function handleDetailImageUpload(options: { file: File }) {
  if (!detailProduct.value?.id) return
  await uploadProductImage(detailProduct.value.id, options.file)
}

async function handleEditImageUpload(options: { file: File }) {
  if (!editingProduct.value?.id) return
  await uploadProductImage(editingProduct.value.id, options.file)
}

async function disableProduct(row: any) {
  try {
    await erpConfirm(`确认禁用商品「${row.name}」（${row.sku}）？禁用后不可用于新采购下单。`, '禁用商品', { type: 'warning' })
    const ok = await withAction(async () => {
      await productApi.disable(row.id)
    }, '商品已禁用')
    if (ok) load()
  } catch { /* cancelled */ }
}

async function enableProduct(row: any) {
  const ok = await withAction(async () => {
    await productApi.enable(row.id)
  }, '商品已启用')
  if (ok) load()
}

function productLabelItem(row: { sku?: string; name?: string; barcode?: string }) {
  return { sku: row.sku || '', barcode: row.barcode || row.sku || '' }
}

async function printSkuLabels(items: Array<{ sku?: string; name?: string; barcode?: string }>) {
  if (!items.length) {
    ElMessage.warning('请先勾选要打印条码的商品')
    return
  }
  const ok = await printProductSkuLabels(items.map(productLabelItem))
  if (ok) ElMessage.success(`已打开 ${items.length} 个 SKU 标签打印预览`)
}
</script>

<template>
  <div class="products-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span class="page-title">商品主数据</span>
          <div class="header-actions">
            <el-input v-model="skuQ" placeholder="搜索 SKU" clearable style="width: 160px" size="small" />
            <el-input v-model="nameQ" placeholder="搜索商品名称" clearable style="width: 160px" size="small" />
            <el-button v-if="app.hasPerm('products.edit')" type="primary" size="small" @click="openCreate">+ 创建商品</el-button>
            <template v-if="app.hasPerm('products.edit')">
              <el-button size="small" link type="primary" @click="downloadProductImportTemplate">下载模板</el-button>
              <el-button size="small" @click="importProducts">批量导入</el-button>
            </template>
            <el-button size="small" @click="selectAll">全选</el-button>
            <el-button size="small" :disabled="!selectedRows.length" @click="clearSelection">取消选择</el-button>
            <span v-if="selectedRows.length" class="sel-count">已选 {{ selectedRows.length }} 条</span>
            <el-button type="primary" size="small" :disabled="!selectedRows.length" @click="exportSelected">导出选中</el-button>
            <el-button v-if="canPrintLabel" size="small" :disabled="!selectedRows.length" @click="printSkuLabels(selectedRows)">打印 SKU 标签</el-button>
          </div>
        </div>
      </template>

      <el-tabs v-model="filter" type="card">
        <el-tab-pane v-for="f in filters" :key="f.id" :label="f.label" :name="f.id" />
      </el-tabs>

      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
        选品链路商品主数据在<strong>采购主管审核通过</strong>后自动从预采购/正式采购单同步写入；此前无需手工维护主数据。
      </el-alert>

      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="pagedItems"
        :row-key="(row) => row.id"
        stripe
        border
        style="width: 100%"
        size="small"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="46" fixed="left" reserve-selection />
        <el-table-column prop="sku" label="SKU" width="110">
          <template #default="{ row }">
            <span style="font-family: var(--font-mono); font-size: 12px">{{ row.sku }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="spu" label="SPU" width="120" />
        <el-table-column label="图片" width="72" align="center">
          <template #default="{ row }">
            <div v-if="row.imageUrl" class="thumb-wrap">
              <el-image
                :src="productImageSrc(row.imageUrl)"
                fit="cover"
                class="product-thumb"
                :preview-src-list="productPreviewList(row.imageUrls)"
                preview-teleported
              />
              <span v-if="row.imageCount > 1" class="img-count">{{ row.imageCount }}</span>
            </div>
            <span v-else class="no-thumb">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="商品名称" min-width="150" />
        <el-table-column prop="spec" label="规格" width="80" />
        <el-table-column prop="cost" label="综合成本 (RMB)" width="120" align="right">
          <template #default="{ row }">
            <span title="采购 + 海运 + 国内运费">¥ {{ formatMoney(row.totalCost || row.cost) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="developer" label="开发人" width="80" />
        <el-table-column prop="purchaser" label="采购员" width="80" />
        <el-table-column prop="supplier" label="供应商" min-width="130" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.tone === 'ok' ? 'success' : row.tone === 'danger' ? 'danger' : row.tone === 'neutral' ? 'info' : 'warning'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sync" label="同步" width="110">
          <template #default="{ row }">
            <span :style="{ color: row.sync.includes('✓') ? '#1f9d92' : '#8b95a8', fontSize: '12px' }">{{ row.sync }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row.id)">编辑</el-button>
            <el-button link type="primary" size="small" @click="openDetail(row.id)">详情</el-button>
            <el-button v-if="canPrintLabel" link type="success" size="small" @click="printSkuLabels([row])">打印标签</el-button>
            <el-button
              v-if="row.statusKey !== 'inactive'"
              link
              type="danger"
              size="small"
              @click="disableProduct(row)"
            >禁用</el-button>
            <el-button
              v-else
              link
              type="success"
              size="small"
              @click="enableProduct(row)"
            >启用</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </el-card>
  </div>

  <!-- Create Product Dialog -->
  <el-dialog v-model="createVisible" title="创建商品" width="680px" destroy-on-close>
    <el-form label-width="96px">
      <el-form-item label="SKU" required>
        <el-input v-model="createForm.sku" placeholder="如 TK-00123" maxlength="30" />
      </el-form-item>
      <el-form-item label="SPU">
        <el-input v-model="createForm.spu" placeholder="可选" maxlength="30" />
      </el-form-item>
      <el-form-item label="商品名称" required>
        <el-input v-model="createForm.productName" placeholder="商品中文名称" maxlength="300" />
      </el-form-item>
      <el-form-item label="规格">
        <el-input v-model="createForm.spec" placeholder="如 黑色 / L码" maxlength="100" />
      </el-form-item>
      <el-form-item label="成本 (RMB)">
        <el-input v-model="createForm.costRmb" placeholder="0" style="width: 160px" />
      </el-form-item>
      <el-form-item label="开发人">
        <el-select v-model="createForm.developerId" placeholder="选择开发人" clearable filterable style="width: 100%">
          <el-option v-for="u in developerOptions" :key="u.id" :label="u.label" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="采购员">
        <el-select v-model="createForm.purchaserId" placeholder="选择采购员" clearable filterable style="width: 100%">
          <el-option v-for="u in purchaserOptions" :key="u.id" :label="u.label" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="供应商">
        <el-select v-model="createForm.supplierId" placeholder="选择供应商" clearable filterable style="width: 100%">
          <el-option v-for="s in supplierOptions" :key="s.id" :label="s.label" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="尺寸 (cm)">
        <div style="display:flex;gap:8px">
          <el-input v-model="createForm.lengthCm" placeholder="长" style="width:80px" />
          <el-input v-model="createForm.widthCm" placeholder="宽" style="width:80px" />
          <el-input v-model="createForm.heightCm" placeholder="高" style="width:80px" />
        </div>
      </el-form-item>
      <el-form-item label="重量 (kg)">
        <el-input v-model="createForm.weightKg" placeholder="0" style="width: 120px" />
      </el-form-item>
      <el-form-item label="条码">
        <el-input v-model="createForm.barcode" placeholder="EAN / 条码" maxlength="50" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="createForm.status" style="width: 160px">
          <el-option v-for="opt in STATUS_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
      </el-form-item>
      <p class="create-hint">图片可在创建成功后于「编辑」中上传；同步状态默认为「未同步」。</p>
    </el-form>
    <template #footer>
      <el-button @click="createVisible = false">取消</el-button>
      <el-button type="primary" :loading="createSaving" @click="saveCreate">创建</el-button>
    </template>
  </el-dialog>

  <!-- Product Detail Dialog -->
  <el-dialog v-model="detailVisible" :title="'商品详情 · ' + (detailProduct?.sku || '')" width="860px" top="4vh" destroy-on-close class="erp-detail">
    <div v-if="detailProduct" class="product-detail">
      <div class="product-image-panel">
        <div v-if="detailProduct.images?.length" class="image-gallery">
          <div v-for="img in detailProduct.images" :key="img.id || img.imageUrl" class="gallery-item">
            <el-image
              :src="productImageSrc(img.imageUrl)"
              fit="cover"
              class="gallery-image"
              :preview-src-list="productPreviewList(detailProduct.imageUrls)"
              preview-teleported
            />
            <el-button
              v-if="img.id"
              class="gallery-remove"
              type="danger"
              circle
              size="small"
              @click="removeProductImage(detailProduct.id, img.id)"
            >×</el-button>
          </div>
        </div>
        <div v-else class="image-box">
          <div class="image-placeholder">暂无图片</div>
        </div>
        <el-upload
          multiple
          :show-file-list="false"
          accept="image/*"
          :disabled="imageUploading || detailProduct.imageCount >= MAX_PRODUCT_IMAGES"
          :http-request="handleDetailImageUpload"
        >
          <el-button
            type="primary"
            size="small"
            :loading="imageUploading"
            :disabled="detailProduct.imageCount >= MAX_PRODUCT_IMAGES"
          >
            上传图片
          </el-button>
        </el-upload>
        <p class="image-hint">
          支持 JPG / PNG / GIF / WebP，单张最大 5MB，最多 {{ MAX_PRODUCT_IMAGES }} 张
          <span v-if="detailProduct.imageCount">（已上传 {{ detailProduct.imageCount }} 张）</span>
        </p>
      </div>
      <div class="product-info-panel">
        <DetailSheet :kicker="detailProduct.sku" :title="detailProduct.name" :subtitle="[detailProduct.spec, detailProduct.supplier].filter(Boolean).join(' · ')">
          <template #status>
            <el-tag size="small">{{ detailProduct.status }}</el-tag>
          </template>
          <template #metrics>
            <div class="erp-detail__metric">
              <label>采购成本</label>
              <strong>¥ {{ formatMoney(detailProduct.purchaseCost) }}</strong>
            </div>
            <div class="erp-detail__metric">
              <label>海运费用</label>
              <strong>¥ {{ formatMoney(detailProduct.seaFreight) }}</strong>
            </div>
            <div class="erp-detail__metric">
              <label>国内运费</label>
              <strong>¥ {{ formatMoney(detailProduct.domesticFee) }}</strong>
            </div>
            <div class="erp-detail__metric is-accent">
              <label>综合成本</label>
              <strong>¥ {{ formatMoney(detailProduct.totalCost || detailProduct.cost) }}</strong>
            </div>
          </template>
        </DetailSheet>
        <dl class="info-list">
          <div class="info-row"><dt>SPU</dt><dd>{{ detailProduct.spu || '—' }}</dd></div>
          <div class="info-row"><dt>规格</dt><dd>{{ detailProduct.spec || '—' }}</dd></div>
          <div class="info-row"><dt>尺寸 (cm)</dt><dd>{{ detailProduct.length }}×{{ detailProduct.width }}×{{ detailProduct.height }}</dd></div>
          <div class="info-row"><dt>重量 (kg)</dt><dd>{{ detailProduct.weight || '—' }}</dd></div>
          <div class="info-row"><dt>条码</dt><dd>{{ detailProduct.barcode || '—' }}</dd></div>
          <div class="info-row"><dt>开发人</dt><dd>{{ detailProduct.developer }}</dd></div>
          <div class="info-row"><dt>采购员</dt><dd>{{ detailProduct.purchaser }}</dd></div>
          <div class="info-row"><dt>供应商</dt><dd>{{ detailProduct.supplier }}</dd></div>
          <div class="info-row"><dt>同步</dt><dd>{{ detailProduct.sync }}</dd></div>
        </dl>
        <p class="cost-hint">综合成本 = 采购成本 + 海运费用 + 国内运费；海运费在入库发运回传后写入。</p>
      </div>
    </div>

    <el-divider v-if="detailProduct" content-position="left">操作记录</el-divider>
    <el-timeline v-if="detailProduct?.history?.length" class="product-history">
      <el-timeline-item v-for="(h, i) in detailProduct.history" :key="i" :timestamp="h.time" placement="top">
        <span class="hist-op">{{ h.operator }}</span>
        <span class="hist-meta"> · {{ h.role }} · {{ h.action }}</span>
        <div v-if="h.detail" class="hist-detail">{{ h.detail }}</div>
      </el-timeline-item>
    </el-timeline>
    <el-empty v-else-if="detailProduct" description="暂无操作记录" :image-size="60" />

    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
      <el-button v-if="canPrintLabel" type="success" plain @click="printSkuLabels([detailProduct])">打印 SKU 标签</el-button>
      <el-button type="primary" @click="detailVisible = false; openEdit(detailProduct.id)">编辑</el-button>
    </template>
  </el-dialog>

  <!-- Edit Product Dialog -->
  <el-dialog v-model="dialogVisible" :title="'编辑商品 · ' + (editingProduct?.sku || '')" width="680px">
    <el-form v-if="editingProduct" label-width="90px">
      <el-form-item label="商品图片">
        <div class="edit-image-section">
          <div v-if="editingProduct.images?.length" class="image-gallery edit">
            <div v-for="img in editingProduct.images" :key="img.id || img.imageUrl" class="gallery-item">
              <el-image
                :src="productImageSrc(img.imageUrl)"
                fit="cover"
                class="gallery-image"
                :preview-src-list="productPreviewList(editingProduct.imageUrls)"
                preview-teleported
              />
              <el-button
                v-if="img.id"
                class="gallery-remove"
                type="danger"
                circle
                size="small"
                @click="removeProductImage(editingProduct.id, img.id)"
              >×</el-button>
            </div>
          </div>
          <div v-else class="image-box small">
            <div class="image-placeholder">暂无</div>
          </div>
          <el-upload
            multiple
            :show-file-list="false"
            accept="image/*"
            :disabled="imageUploading || editingProduct.imageCount >= MAX_PRODUCT_IMAGES"
            :http-request="handleEditImageUpload"
          >
            <el-button
              size="small"
              :loading="imageUploading"
              :disabled="editingProduct.imageCount >= MAX_PRODUCT_IMAGES"
            >上传图片</el-button>
          </el-upload>
          <p class="image-hint inline">
            最多 {{ MAX_PRODUCT_IMAGES }} 张
            <span v-if="editingProduct.imageCount">（已上传 {{ editingProduct.imageCount }} 张）</span>
          </p>
        </div>
      </el-form-item>
      <el-form-item label="商品名称"><el-input v-model="editingProduct.name" /></el-form-item>
      <el-form-item label="SKU"><el-input v-model="editingProduct.sku" readonly /></el-form-item>
      <el-form-item label="SPU"><el-input v-model="editingProduct.spu" /></el-form-item>
      <el-form-item label="规格"><el-input v-model="editingProduct.spec" /></el-form-item>
      <el-form-item label="采购成本 (RMB)"><el-input v-model="editingProduct.purchaseCost" /></el-form-item>
      <el-form-item label="开发人">
        <el-select v-model="editingProduct.developerId" placeholder="选择开发人" clearable filterable style="width: 100%">
          <el-option v-for="u in developerOptions" :key="u.id" :label="u.label" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="采购员">
        <el-select v-model="editingProduct.purchaserId" placeholder="选择采购员" clearable filterable style="width: 100%">
          <el-option v-for="u in purchaserOptions" :key="u.id" :label="u.label" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="供应商">
        <el-select v-model="editingProduct.supplierId" placeholder="选择供应商" clearable filterable style="width: 100%">
          <el-option v-for="s in supplierOptions" :key="s.id" :label="s.label" :value="s.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="尺寸 (cm)">
        <div style="display:flex;gap:8px">
          <el-input v-model="editingProduct.length" placeholder="长" style="width:80px" />
          <el-input v-model="editingProduct.width" placeholder="宽" style="width:80px" />
          <el-input v-model="editingProduct.height" placeholder="高" style="width:80px" />
        </div>
      </el-form-item>
      <el-form-item label="重量 (kg)"><el-input v-model="editingProduct.weight" style="width:120px" /></el-form-item>
      <el-form-item label="条码"><el-input v-model="editingProduct.barcode" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveProduct">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-weight: 600; font-size: 15px; }
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sel-count { font-size: 12px; color: var(--cyan); white-space: nowrap; }
.product-thumb { width: 40px; height: 40px; border-radius: 4px; border: 1px solid var(--border); }
.thumb-wrap { position: relative; display: inline-block; }
.img-count {
  position: absolute; right: -4px; bottom: -4px; min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--primary); color: #fff; font-size: 10px; line-height: 16px; text-align: center;
}
.no-thumb { color: var(--text-muted); font-size: 12px; }
.product-detail { display: flex; gap: 24px; align-items: flex-start; }
.product-image-panel { width: 280px; flex-shrink: 0; }
.product-info-panel { flex: 1; min-width: 0; }
.image-gallery {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px;
}
.image-gallery.edit { grid-template-columns: repeat(4, 72px); }
.gallery-item { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.gallery-image { width: 100%; height: 100%; }
.gallery-remove {
  position: absolute; top: 4px; right: 4px; width: 20px !important; height: 20px !important;
  min-height: 20px; padding: 0 !important; font-size: 14px; line-height: 1;
}
.image-box {
  width: 200px; height: 120px; border: 1px dashed var(--border); border-radius: 8px;
  background: var(--panel-soft); display: flex; align-items: center; justify-content: center;
  overflow: hidden; margin-bottom: 12px;
}
.image-box.small { width: 72px; height: 72px; margin-bottom: 0; }
.image-placeholder { color: var(--text-muted); font-size: 13px; }
.image-hint { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.image-hint.inline { margin: 8px 0 0; }
.edit-image-section { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.info-list { margin: 0; }
.info-row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
.info-row dt { width: 88px; flex-shrink: 0; color: var(--text-muted); font-weight: 500; }
.info-row dd { margin: 0; color: var(--text); word-break: break-all; }
.info-row.cost-row dd { font-family: var(--font-mono, monospace); }
.info-row.total dt, .info-row.total dd { color: var(--cyan); font-weight: 600; }
.cost-hint { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.product-info-panel :deep(.erp-detail__metrics) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.product-history { margin-top: 4px; padding-left: 4px; max-height: 240px; overflow-y: auto; }
.hist-op { font-weight: 600; color: var(--text); }
.hist-meta { color: var(--text-muted); }
.hist-detail { margin-top: 2px; color: var(--text-secondary); font-size: 12px; }
.create-hint { margin: 0 0 0 96px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
@media (max-width: 800px) {
  .product-detail { flex-direction: column; }
  .product-image-panel { width: 100%; }
}
</style>
