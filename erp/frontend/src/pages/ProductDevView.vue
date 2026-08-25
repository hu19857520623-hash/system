<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { erpConfirm } from '@/utils/messageBox'
import { productDevApi } from '@/api/client.js'
import { mapProductDev } from '@/api/mappers.ts'
import { productDevImageSrc } from '@/utils/productDevImage.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import { PIPELINE_DEV_ALERT } from '@/constants/productPipeline.ts'

const app = useAppStore()

const tab = ref('all')
const searchQ = ref('')

const SEA_CHANNELS = ['普货拼柜', '特货拼柜', '整柜', '空运', '铁路', '其他']

const { loading, items: products, load } = useListLoader(async () => {
  const res = await productDevApi.list({ pageSize: 100 })
  return { items: (res.items || []).map(mapProductDev), total: res.total }
})

onMounted(() => load())

const statusMap: Record<string, { label: string; type: string }> = {
  draft: { label: '草稿', type: 'info' },
  submitted: { label: '审核中', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
}

const canEdit = computed(() => app.hasPerm('product_dev.edit'))
const canCreate = computed(() => app.hasPerm('product_dev.create'))

const stats = computed(() => {
  const s = { draft: 0, submitted: 0, approved: 0, rejected: 0 }
  products.value.forEach(p => { s[p.statusKey as keyof typeof s]++ })
  return s
})

const filtered = computed(() => {
  return products.value.filter(p => {
    if (['draft', 'submitted', 'approved', 'rejected'].includes(tab.value) && p.statusKey !== tab.value) return false
    if (searchQ.value && !p.name.toLowerCase().includes(searchQ.value.toLowerCase()) && !p.applyNo.toLowerCase().includes(searchQ.value.toLowerCase()) && !(p.sku || '').toLowerCase().includes(searchQ.value.toLowerCase())) return false
    return true
  })
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(filtered)
watch([tab, searchQ], resetPage)

interface DevForm {
  sku: string
  name: string
  link: string
  takealotPriceImageUrl: string
  amazonUrl: string
  alibaba1688Url: string
  alibaba1688ImageUrl: string
  spec: string
  productLengthCm: string
  productWidthCm: string
  productHeightCm: string
  packageLengthCm: string
  packageWidthCm: string
  packageHeightCm: string
  cost: string
  marketPrice: string
  sellPriceRmb: string
  maxSellPriceRmb: string
  seaFreightChannel: string
  cbm: string
  volumetricWeightKg: string
  reason: string
}

function emptyForm(): DevForm {
  return {
    sku: '',
    name: '',
    link: '',
    takealotPriceImageUrl: '',
    amazonUrl: '',
    alibaba1688Url: '',
    alibaba1688ImageUrl: '',
    spec: '',
    productLengthCm: '',
    productWidthCm: '',
    productHeightCm: '',
    packageLengthCm: '',
    packageWidthCm: '',
    packageHeightCm: '',
    cost: '',
    marketPrice: '',
    sellPriceRmb: '',
    maxSellPriceRmb: '',
    seaFreightChannel: '',
    cbm: '',
    volumetricWeightKg: '',
    reason: '',
  }
}

const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const form = ref<DevForm>(emptyForm())
const priceImageUploading = ref(false)
const alibabaImageUploading = ref(false)

async function fileToBase64(file: File) {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary)
}

async function uploadDevImage(
  file: File,
  field: 'takealotPriceImageUrl' | 'alibaba1688ImageUrl',
  uploading: { value: boolean },
  successText: string,
) {
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请上传图片文件')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 5MB')
    return
  }
  uploading.value = true
  try {
    const res = await productDevApi.uploadPriceImage({
      fileName: file.name,
      contentBase64: await fileToBase64(file),
    })
    form.value[field] = res.imageUrl
    ElMessage.success(successText)
  } catch (err: any) {
    ElMessage.error(err?.message || '图片上传失败')
  } finally {
    uploading.value = false
  }
}

async function handlePriceImageUpload(options: { file: File }) {
  await uploadDevImage(options.file, 'takealotPriceImageUrl', priceImageUploading, '售价图已上传')
}

async function handleAlibabaImageUpload(options: { file: File }) {
  await uploadDevImage(options.file, 'alibaba1688ImageUrl', alibabaImageUploading, '1688 产品图已上传')
}

function submitMissingMessage() {
  if (!form.value.sku.trim()) return '请填写 SKU'
  if (!form.value.name.trim()) return '请填写商品名称'
  if (!form.value.link.trim()) return '请填写 Takealot 链接'
  if (!form.value.takealotPriceImageUrl.trim()) return '请上传 Takealot 售价图'
  if (form.value.cost === '' || !Number.isFinite(Number(form.value.cost))) return '请填写采购价格'
  if (form.value.marketPrice === '' || !Number.isFinite(Number(form.value.marketPrice))) return '请填写市场参考价'
  return null
}

function calcVolumeMetrics(lengthCm: string, widthCm: string, heightCm: string) {
  const l = Number(lengthCm)
  const w = Number(widthCm)
  const h = Number(heightCm)
  if (!l || !w || !h) return { cbm: '', volumetricWeightKg: '' }
  const cbm = (l * w * h) / 1_000_000
  const volumetricWeightKg = cbm * 167
  return {
    cbm: cbm.toFixed(6),
    volumetricWeightKg: volumetricWeightKg.toFixed(3),
  }
}

const autoVolume = computed(() =>
  calcVolumeMetrics(form.value.packageLengthCm, form.value.packageWidthCm, form.value.packageHeightCm),
)

watch(
  () => [form.value.packageLengthCm, form.value.packageWidthCm, form.value.packageHeightCm],
  () => {
    const m = autoVolume.value
    if (m.cbm) {
      form.value.cbm = m.cbm
      form.value.volumetricWeightKg = m.volumetricWeightKg
    }
  },
)

const estProfit = computed(() => {
  const sell = Number(form.value.sellPriceRmb)
  const cost = Number(form.value.cost)
  if (!sell || !cost) return null
  return sell - cost
})

const estProfitRate = computed(() => {
  const sell = Number(form.value.sellPriceRmb)
  if (!sell || estProfit.value == null) return null
  return (estProfit.value / sell) * 100
})

const maxEstProfit = computed(() => {
  const sell = Number(form.value.maxSellPriceRmb)
  const cost = Number(form.value.cost)
  if (!sell || !cost) return null
  return sell - cost
})

function formPayload(status?: string) {
  return {
    sku: form.value.sku.trim() || undefined,
    productName: form.value.name,
    takealotUrl: form.value.link,
    takealotPriceImageUrl: form.value.takealotPriceImageUrl,
    amazonUrl: form.value.amazonUrl,
    alibaba1688Url: form.value.alibaba1688Url,
    alibaba1688ImageUrl: form.value.alibaba1688ImageUrl,
    spec: form.value.spec,
    productLengthCm: form.value.productLengthCm !== '' ? Number(form.value.productLengthCm) : undefined,
    productWidthCm: form.value.productWidthCm !== '' ? Number(form.value.productWidthCm) : undefined,
    productHeightCm: form.value.productHeightCm !== '' ? Number(form.value.productHeightCm) : undefined,
    packageLengthCm: form.value.packageLengthCm !== '' ? Number(form.value.packageLengthCm) : undefined,
    packageWidthCm: form.value.packageWidthCm !== '' ? Number(form.value.packageWidthCm) : undefined,
    packageHeightCm: form.value.packageHeightCm !== '' ? Number(form.value.packageHeightCm) : undefined,
    estimatedCost: Number(form.value.cost) || undefined,
    marketPrice: Number(form.value.marketPrice) || undefined,
    sellPriceRmb: Number(form.value.sellPriceRmb) || undefined,
    maxSellPriceRmb: Number(form.value.maxSellPriceRmb) || undefined,
    seaFreightChannel: form.value.seaFreightChannel || undefined,
    cbm: form.value.cbm !== '' ? Number(form.value.cbm) : undefined,
    volumetricWeightKg: form.value.volumetricWeightKg !== '' ? Number(form.value.volumetricWeightKg) : undefined,
    reason: form.value.reason,
    ...(status ? { status } : {}),
  }
}

function fillFormFromProduct(p: ReturnType<typeof mapProductDev>) {
  form.value = {
    sku: p.sku || '',
    name: p.name,
    link: p.link === '#' ? '' : p.link,
    takealotPriceImageUrl: p.takealotPriceImageUrl || '',
    amazonUrl: p.amazonUrl || '',
    alibaba1688Url: p.alibaba1688Url || '',
    alibaba1688ImageUrl: p.alibaba1688ImageUrl || '',
    spec: p.spec,
    productLengthCm: p.productLengthCm ? String(p.productLengthCm) : '',
    productWidthCm: p.productWidthCm ? String(p.productWidthCm) : '',
    productHeightCm: p.productHeightCm ? String(p.productHeightCm) : '',
    packageLengthCm: p.packageLengthCm ? String(p.packageLengthCm) : '',
    packageWidthCm: p.packageWidthCm ? String(p.packageWidthCm) : '',
    packageHeightCm: p.packageHeightCm ? String(p.packageHeightCm) : '',
    cost: p.cost ? String(p.cost) : '',
    marketPrice: p.marketPrice ? String(p.marketPrice) : '',
    sellPriceRmb: p.sellPriceRmb ? String(p.sellPriceRmb) : '',
    maxSellPriceRmb: p.maxSellPriceRmb ? String(p.maxSellPriceRmb) : '',
    seaFreightChannel: p.seaFreightChannel || '',
    cbm: p.cbm ? String(p.cbm) : '',
    volumetricWeightKg: p.volumetricWeightKg ? String(p.volumetricWeightKg) : '',
    reason: p.reason,
  }
}

async function submitAudit(id: number) {
  const p = products.value.find(x => x.id === id)
  if (p) {
    if (!p.sku?.trim()) { ElMessage.warning('请填写 SKU'); return }
    if (!p.link || p.link === '#') { ElMessage.warning('请填写 Takealot 链接'); return }
    if (!p.takealotPriceImageUrl) { ElMessage.warning('请上传 Takealot 售价图'); return }
    if (!p.cost) { ElMessage.warning('请填写采购价格'); return }
    if (!p.marketPrice) { ElMessage.warning('请填写市场参考价'); return }
  }
  const ok = await withAction(async () => {
    await productDevApi.submit(id)
  }, '已提交审核')
  if (ok) load()
}

async function withdraw(id: number) {
  try {
    await erpConfirm('确认撤回该申请到草稿状态？', '撤回申请', { type: 'warning' })
    const ok = await withAction(async () => {
      await productDevApi.update(id, { status: 'draft' })
    }, '已撤回到草稿')
    if (ok) load()
  } catch { /* cancelled */ }
}

function openNewApply() {
  editingId.value = null
  form.value = emptyForm()
  dialogVisible.value = true
}

function openEdit(id: number) {
  const p = products.value.find(x => x.id === id)
  if (!p) return
  editingId.value = id
  fillFormFromProduct(p)
  dialogVisible.value = true
}

async function saveDraft() {
  if (!form.value.name) { ElMessage.warning('请填写商品名称'); return }
  const ok = await withAction(async () => {
    if (editingId.value) {
      await productDevApi.update(editingId.value, formPayload('draft'))
    } else {
      await productDevApi.create(formPayload('draft'))
    }
  }, '已保存草稿')
  if (ok) { dialogVisible.value = false; load() }
}

async function submitForm() {
  const missing = submitMissingMessage()
  if (missing) { ElMessage.warning(missing); return }
  if (estProfit.value != null && estProfit.value < 0) {
    try {
      await erpConfirm(
        `按当前售价与采购价测算，预估利润为 ¥${estProfit.value.toFixed(2)}，确认仍要提交吗？`,
        '利润预警',
        { type: 'warning', confirmButtonText: '仍然提交', cancelButtonText: '返回修改' },
      )
    } catch { return }
  }
  const ok = await withAction(async () => {
    if (editingId.value) {
      await productDevApi.update(editingId.value, formPayload())
      await productDevApi.submit(editingId.value)
    } else {
      const created = await productDevApi.create(formPayload('draft'))
      await productDevApi.submit(Number(created.id))
    }
  }, '选品申请已提交审核')
  if (ok) { dialogVisible.value = false; load() }
}
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">产品开发 · 选品申请</span>
        <div class="header-actions">
          <el-input v-model="searchQ" placeholder="搜索商品名称 / SKU / 申请单号" clearable style="width:200px" size="small" />
          <el-button v-if="canCreate" type="primary" size="small" @click="openNewApply">新建选品申请</el-button>
        </div>
      </div>
    </template>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px">
      流程：{{ PIPELINE_DEV_ALERT }}
    </el-alert>

    <div class="stat-bar">
      <div class="stat-item" :class="{ active: tab === 'draft' }" @click="tab = 'draft'">
        <div class="stat-num">{{ stats.draft }}</div><div class="stat-label">草稿</div>
      </div>
      <div class="stat-item" :class="{ active: tab === 'submitted' }" @click="tab = 'submitted'">
        <div class="stat-num warn">{{ stats.submitted }}</div><div class="stat-label">审核中</div>
      </div>
      <div class="stat-item" :class="{ active: tab === 'approved' }" @click="tab = 'approved'">
        <div class="stat-num success">{{ stats.approved }}</div><div class="stat-label">已通过</div>
      </div>
      <div class="stat-item" :class="{ active: tab === 'rejected' }" @click="tab = 'rejected'">
        <div class="stat-num danger">{{ stats.rejected }}</div><div class="stat-label">已驳回</div>
      </div>
    </div>

    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="全部选品" name="all" />
      <el-tab-pane label="草稿" name="draft" />
      <el-tab-pane label="审核中" name="submitted" />
      <el-tab-pane label="已通过" name="approved" />
      <el-tab-pane label="已驳回" name="rejected" />
    </el-tabs>

    <el-table v-loading="loading" :data="pagedItems" stripe border size="small">
      <el-table-column prop="applyNo" label="申请单号" width="120">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.applyNo }}</span></template>
      </el-table-column>
      <el-table-column prop="sku" label="SKU" width="110">
        <template #default="{ row }">
          <span style="font-family:var(--font-mono);font-size:12px">{{ row.sku || '待分配' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="商品名" min-width="140" />
      <el-table-column prop="spec" label="规格" width="80" />
      <el-table-column prop="cost" label="采购价" width="88" align="right">
        <template #default="{ row }">{{ row.cost ? `¥ ${row.cost}` : '—' }}</template>
      </el-table-column>
      <el-table-column label="售价 RMB" width="92" align="right">
        <template #default="{ row }">{{ row.sellPriceRmb ? `¥ ${row.sellPriceRmb}` : '—' }}</template>
      </el-table-column>
      <el-table-column label="市场参考价" width="96" align="right">
        <template #default="{ row }">
          <span v-if="row.marketPrice">R {{ row.marketPrice }}</span>
          <span v-else style="color:#b0a89c">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="(statusMap[row.statusKey]?.type as any) || 'info'" size="small">{{ statusMap[row.statusKey]?.label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="time" label="更新时间" width="110" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.statusKey === 'draft' && canEdit" link type="primary" size="small" @click="openEdit(row.id)">编辑</el-button>
          <el-button v-if="row.statusKey === 'draft' && canEdit" link type="success" size="small" @click="submitAudit(row.id)">提交审核</el-button>
          <el-button v-if="row.statusKey === 'submitted' && canEdit" link type="warning" size="small" @click="withdraw(row.id)">撤回</el-button>
          <el-button v-if="row.statusKey === 'rejected' && canEdit" link type="primary" size="small" @click="openEdit(row.id)">修改重提</el-button>
          <el-tag v-if="row.statusKey === 'approved'" type="success" size="small" effect="plain">已进入采购流程</el-tag>
        </template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    <p style="font-size:11px;color:#8b95a8;margin-top:10px">提交审核时需填写 SKU、Takealot 链接、售价图、采购价格与市场参考价；包装尺寸填写后自动计算 CBM 与体积重。核定数量为计划参考，实际采购以采购单为准。</p>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="editingId ? '编辑选品申请' : '新建选品申请'" width="780px" top="4vh" destroy-on-close>
    <el-scrollbar max-height="70vh">
      <el-form label-width="118px" class="dev-form">
        <el-divider content-position="left">基本信息</el-divider>
        <el-form-item label="SKU" required>
          <el-input v-model="form.sku" placeholder="请填写 SKU" maxlength="30" />
        </el-form-item>
        <el-form-item label="商品名称" required>
          <el-input v-model="form.name" placeholder="输入商品名称" />
        </el-form-item>
        <el-form-item label="规格">
          <el-input v-model="form.spec" placeholder="颜色 / 尺寸等" />
        </el-form-item>

        <el-divider content-position="left">链接与图片</el-divider>
        <el-form-item label="Takealot 链接" required>
          <el-input v-model="form.link" placeholder="https://www.takealot.com/..." />
        </el-form-item>
        <el-form-item label="Takealot 售价图" required>
          <div class="upload-block">
            <el-upload
              :show-file-list="false"
              accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
              :disabled="priceImageUploading"
              :http-request="handlePriceImageUpload"
            >
              <el-button size="small" :loading="priceImageUploading">上传文件</el-button>
            </el-upload>
            <div v-if="form.takealotPriceImageUrl" class="image-preview-row">
              <el-image
                :src="productDevImageSrc(form.takealotPriceImageUrl)"
                fit="cover"
                class="preview-img"
                :preview-src-list="[productDevImageSrc(form.takealotPriceImageUrl)]"
                preview-teleported
              />
              <el-button link type="danger" size="small" @click="form.takealotPriceImageUrl = ''">移除</el-button>
            </div>
            <span class="form-tip">支持 JPG / PNG / GIF / WebP，单张最大 5MB</span>
          </div>
        </el-form-item>
        <el-form-item label="亚马逊链接">
          <el-input v-model="form.amazonUrl" placeholder="https://www.amazon.com/..." />
        </el-form-item>
        <el-form-item label="1688 链接">
          <el-input v-model="form.alibaba1688Url" placeholder="https://detail.1688.com/..." />
        </el-form-item>
        <el-form-item label="1688 产品图">
          <div class="upload-block">
            <el-upload
              :show-file-list="false"
              accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
              :disabled="alibabaImageUploading"
              :http-request="handleAlibabaImageUpload"
            >
              <el-button size="small" :loading="alibabaImageUploading">上传文件</el-button>
            </el-upload>
            <div v-if="form.alibaba1688ImageUrl" class="image-preview-row">
              <el-image
                :src="productDevImageSrc(form.alibaba1688ImageUrl)"
                fit="cover"
                class="preview-img"
                :preview-src-list="[productDevImageSrc(form.alibaba1688ImageUrl)]"
                preview-teleported
              />
              <el-button link type="danger" size="small" @click="form.alibaba1688ImageUrl = ''">移除</el-button>
            </div>
            <span class="form-tip">与售价图相同：JPG / PNG / GIF / WebP，单张最大 5MB</span>
          </div>
        </el-form-item>

        <el-divider content-position="left">尺寸（可选）</el-divider>
        <el-form-item label="产品尺寸 (cm)">
          <div class="dim-row">
            <el-input v-model="form.productLengthCm" placeholder="长" style="width:88px" />
            <span>×</span>
            <el-input v-model="form.productWidthCm" placeholder="宽" style="width:88px" />
            <span>×</span>
            <el-input v-model="form.productHeightCm" placeholder="高" style="width:88px" />
          </div>
          <span class="form-tip">产品本身尺寸，可不填</span>
        </el-form-item>
        <el-form-item label="包装尺寸 (cm)">
          <div class="dim-row">
            <el-input v-model="form.packageLengthCm" placeholder="长" style="width:88px" />
            <span>×</span>
            <el-input v-model="form.packageWidthCm" placeholder="宽" style="width:88px" />
            <span>×</span>
            <el-input v-model="form.packageHeightCm" placeholder="高" style="width:88px" />
          </div>
          <span class="form-tip">填写后自动计算 CBM 与体积重（167 kg/m³）</span>
        </el-form-item>

        <el-divider content-position="left">价格与物流</el-divider>
        <el-form-item label="采购价格 (RMB)" required>
          <el-input v-model="form.cost" placeholder="0.00" style="width:160px" />
        </el-form-item>
        <el-form-item label="市场参考价 (R)" required>
          <el-input v-model="form.marketPrice" placeholder="Takealot 竞品在售价（兰特）" style="width:200px" />
        </el-form-item>
        <el-form-item label="售价 RMB">
          <el-input v-model="form.sellPriceRmb" placeholder="计划售价" style="width:160px" />
        </el-form-item>
        <el-form-item label="最高售价 RMB">
          <el-input v-model="form.maxSellPriceRmb" placeholder="售价上限" style="width:160px" />
        </el-form-item>
        <el-form-item label="海运渠道">
          <el-select v-model="form.seaFreightChannel" placeholder="选择海运渠道" clearable style="width:200px">
            <el-option v-for="c in SEA_CHANNELS" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="CBM (m³)">
          <el-input v-model="form.cbm" placeholder="自动计算" style="width:160px" />
        </el-form-item>
        <el-form-item label="体积重 (kg)">
          <el-input v-model="form.volumetricWeightKg" placeholder="自动计算" style="width:160px" />
        </el-form-item>

        <el-divider content-position="left">利润试算</el-divider>
        <el-form-item label="预估利润">
          <div v-if="estProfit != null" class="profit-box" :class="{ warn: estProfit < 0 }">
            <span>¥ {{ estProfit.toFixed(2) }}</span>
            <span v-if="estProfitRate != null" class="profit-rate">（利润率 {{ estProfitRate.toFixed(1) }}%）</span>
            <span class="profit-hint">= 售价 RMB − 采购价格（不含海运/平台费）</span>
          </div>
          <span v-else class="form-tip">填写售价 RMB 与采购价格后自动计算</span>
        </el-form-item>
        <el-form-item v-if="maxEstProfit != null" label="最高利润">
          <div class="profit-box" :class="{ warn: maxEstProfit < 0 }">
            <span>¥ {{ maxEstProfit.toFixed(2) }}</span>
            <span class="profit-hint">= 最高售价 − 采购价格</span>
          </div>
        </el-form-item>

        <el-divider content-position="left">其他</el-divider>
        <el-form-item label="选品理由">
          <el-input v-model="form.reason" type="textarea" :rows="2" placeholder="说明选品依据与市场判断" />
        </el-form-item>
      </el-form>
    </el-scrollbar>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button @click="saveDraft">保存草稿</el-button>
      <el-button type="primary" @click="submitForm">提交申请</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; align-items:center; }

.stat-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
.stat-item {
  position:relative;
  overflow:hidden;
  padding:14px 16px;
  border:1px solid rgba(99,102,241,0.16);
  border-radius:14px;
  background:linear-gradient(145deg,rgba(18,17,48,0.86),rgba(10,9,25,0.72));
  box-shadow:0 12px 32px rgba(0,0,0,0.14);
  cursor:pointer;
  transition:transform 0.18s ease,border-color 0.18s ease,background 0.18s ease,box-shadow 0.18s ease;
}
.stat-item::after {
  content:'';
  position:absolute;
  inset:0 auto 0 0;
  width:3px;
  background:linear-gradient(180deg,#818cf8,#06b6d4);
  opacity:0;
  transition:opacity 0.18s ease;
}
.stat-item:hover {
  transform:translateY(-2px);
  border-color:rgba(99,102,241,0.34);
  background:linear-gradient(145deg,rgba(30,27,75,0.72),rgba(10,9,25,0.82));
}
.stat-item.active {
  border-color:rgba(129,140,248,0.72);
  box-shadow:0 0 0 2px rgba(99,102,241,0.16),0 16px 38px rgba(0,0,0,0.2);
}
.stat-item.active::after { opacity:1; }
.stat-num { font-size:24px; font-weight:700; font-family:var(--font-mono); color:#f1f5f9; line-height:1.1; font-variant-numeric:tabular-nums; }
.stat-num.warn { color:#fbbf24; }
.stat-num.success { color:#34d399; }
.stat-num.danger { color:#f87171; }
.stat-label { font-size:12px; color:#94a3b8; margin-top:6px; }

.dev-form :deep(.el-divider__text) { font-size:12px; color:#858a8c; }
.form-tip { font-size:11px; color:#a39a8c; display:block; margin-top:4px; }
.upload-block { display:flex; flex-direction:column; align-items:flex-start; gap:8px; }
.image-preview-row { display:flex; align-items:center; gap:10px; }
.preview-img { width:80px; height:80px; border-radius:6px; border:1px solid #ece6dd; }
.dim-row { display:flex; align-items:center; gap:8px; }
.profit-box { font-size:14px; color:#1f9d92; font-weight:600; }
.profit-box.warn { color:#c4782b; }
.profit-rate { margin-left:6px; font-weight:500; }
.profit-hint { display:block; font-size:11px; color:#a39a8c; font-weight:400; margin-top:4px; }
@media (max-width:700px) {
  .stat-bar { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
</style>
