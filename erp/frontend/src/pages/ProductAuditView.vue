<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { productDevApi, productApi } from '@/api/client.js'
import { mapProductAudit } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { triggerBlobDownload } from '@/composables/useAsyncIo'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import { PIPELINE_AUDIT_ALERT, PIPELINE_AUDIT_FOOTER } from '@/constants/productPipeline.ts'
import { productDevImageSrc } from '@/utils/productDevImage.ts'

const app = useAppStore()

const tab = ref('list')
const statusFilter = ref('all')
const searchQ = ref('')

const { loading, items: audits, load } = useListLoader(async () => {
  const res = await productDevApi.list({ pageSize: 100 })
  const rows = (res.items || [])
    .filter((r: any) => ['submitted', 'approved', 'rejected'].includes(r.status))
    .map(mapProductAudit)
  return { items: rows, total: rows.length }
})

onMounted(() => load())

const canApprove = computed(() => app.hasPerm('product_audit.approve'))
const canReject = computed(() => app.hasPerm('product_audit.reject'))
const canSetQty = computed(() => app.hasPerm('product_audit.purchase_qty'))

const filtered = computed(() => {
  const q = searchQ.value.trim().toLowerCase()
  return audits.value.filter(d => {
    if (tab.value === 'pending' && d.status !== '待审核') return false
    if (statusFilter.value !== 'all' && d.status !== statusFilter.value) return false
    if (q && !d.name.toLowerCase().includes(q) && !d.applyNo.toLowerCase().includes(q) && !(d.sku || '').toLowerCase().includes(q)) return false
    return true
  })
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(filtered)
watch([tab, statusFilter, searchQ], resetPage)

const dialogVisible = ref(false)
const selectedAudit = ref<any>(null)
const form = ref({ purchaseQty: 0, remark: '' })

const auditProfit = computed(() => {
  const row = selectedAudit.value
  if (!row?.sellPriceRmb || !row?.cost) return null
  return Number(row.sellPriceRmb) - Number(row.cost)
})

const auditProfitRate = computed(() => {
  const row = selectedAudit.value
  if (auditProfit.value == null || !row?.sellPriceRmb) return null
  return (auditProfit.value / Number(row.sellPriceRmb)) * 100
})

function openAudit(row: any) {
  selectedAudit.value = row
  form.value = {
    purchaseQty: row.purchaseQty || 0,
    remark: '',
  }
  dialogVisible.value = true
}

function displayVal(v: unknown, suffix = '') {
  if (v === null || v === undefined || v === '' || v === 0) return '—'
  return `${v}${suffix}`
}

function formatProductDim(row: any) {
  if (!row.productLengthCm) return '—'
  return `${row.productLengthCm} × ${row.productWidthCm} × ${row.productHeightCm} cm`
}

function formatPackageDim(row: any) {
  if (!row.packageLengthCm) return '—'
  return `${row.packageLengthCm} × ${row.packageWidthCm} × ${row.packageHeightCm} cm`
}

function openUrl(url?: string, label = '链接') {
  if (url?.trim()) window.open(url.trim(), '_blank')
  else ElMessage.info(`暂无${label}`)
}

async function approve() {
  if (!selectedAudit.value) return
  if (!form.value.purchaseQty || form.value.purchaseQty <= 0) {
    ElMessage.warning('审核通过前请核定计划采购数量')
    return
  }
  const id = selectedAudit.value.id
  const ok = await withAction(async () => {
    await productDevApi.approve(id, {
      purchaseQty: form.value.purchaseQty,
      remark: form.value.remark,
    })
  }, `已通过，核定计划采购量 ${form.value.purchaseQty.toLocaleString()}，待采购分配`)
  if (ok) {
    dialogVisible.value = false
    load()
  }
}

async function reject() {
  if (!selectedAudit.value) return
  try {
    const { value } = await ElMessageBox.prompt('请输入驳回原因', '驳回选品', { confirmButtonText: '确认驳回', cancelButtonText: '取消', inputType: 'textarea' })
    const ok = await withAction(async () => {
      await productDevApi.reject(selectedAudit.value.id, { remark: value })
    }, '已驳回，退回产品开发')
    if (ok) {
      dialogVisible.value = false
      load()
    }
  } catch { /* cancelled */ }
}

async function downloadLabel(row: any) {
  if (!row.sku || row.sku === '—' || row.sku === '待分配') {
    ElMessage.warning('该选品尚未生成 SKU，请确认审核已通过')
    return
  }
  try {
    const { blob, fileName } = await productApi.downloadSkuLabel(row.sku)
    triggerBlobDownload(blob, fileName)
    ElMessage.success(`已下载 ${row.sku} SKU 标签`)
  } catch (e: any) {
    ElMessage.error(e.message || '标签下载失败')
  }
}

function tagType(status: string) {
  if (status === '待审核') return 'warning'
  if (status === '已驳回') return 'danger'
  return 'success'
}
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">产品审核</span>
        <div class="header-actions">
          <el-input v-model="searchQ" placeholder="搜索申请单号 / 商品名 / SKU" clearable style="width:200px" size="small" />
          <el-select v-model="statusFilter" size="small" style="width:120px">
            <el-option label="全部状态" value="all" />
            <el-option label="待审核" value="待审核" />
            <el-option label="已通过" value="已通过" />
            <el-option label="已驳回" value="已驳回" />
          </el-select>
        </div>
      </div>
    </template>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px">
      {{ PIPELINE_AUDIT_ALERT }}
    </el-alert>

    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="全部申请" name="list" />
      <el-tab-pane label="待我审核" name="pending" />
    </el-tabs>

    <el-table v-loading="loading" :data="pagedItems" stripe border size="small">
      <el-table-column prop="applyNo" label="申请单号" width="120">
        <template #default="{ row }"><span class="mono">{{ row.applyNo }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="选品名称" min-width="130" />
      <el-table-column prop="sku" label="SKU" width="100">
        <template #default="{ row }">
          <span class="mono">{{ row.sku && row.sku !== '—' ? row.sku : '待分配' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="采购价" width="88" align="right">
        <template #default="{ row }">{{ row.cost ? `¥ ${row.cost}` : '—' }}</template>
      </el-table-column>
      <el-table-column label="售价 RMB" width="92" align="right">
        <template #default="{ row }">{{ row.sellPriceRmb ? `¥ ${row.sellPriceRmb}` : '—' }}</template>
      </el-table-column>
      <el-table-column prop="purchaseQty" label="计划采购量" width="100" align="right">
        <template #default="{ row }">{{ row.purchaseQty ? row.purchaseQty.toLocaleString() : '—' }}</template>
      </el-table-column>
      <el-table-column prop="seaFreightChannel" label="海运渠道" width="88">
        <template #default="{ row }">{{ row.seaFreightChannel || '—' }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="88">
        <template #default="{ row }"><el-tag :type="(tagType(row.status) as any)" size="small">{{ row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="user" label="提交人" width="80" />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openAudit(row)">{{ row.status === '待审核' ? '审核' : '查看' }}</el-button>
          <el-button v-if="row.status === '已通过'" link type="primary" size="small" @click="downloadLabel(row)">下载标签</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    <p class="page-foot">{{ PIPELINE_AUDIT_FOOTER }}</p>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="selectedAudit?.applyNo + ' · 选品审核'" width="780px" top="4vh" destroy-on-close class="erp-detail">
    <el-scrollbar v-if="selectedAudit" max-height="70vh">
      <el-form label-width="118px" class="audit-detail-form">
        <el-divider content-position="left">基本信息</el-divider>
        <el-form-item label="申请单号"><el-input :model-value="selectedAudit.applyNo" readonly /></el-form-item>
        <el-form-item label="选品名称"><el-input :model-value="selectedAudit.name" readonly /></el-form-item>
        <el-form-item label="SKU">
          <el-input :model-value="selectedAudit.sku && selectedAudit.sku !== '—' ? selectedAudit.sku : '—'" readonly />
          <span class="form-tip">提交申请时必填</span>
        </el-form-item>
        <el-form-item label="规格"><el-input :model-value="displayVal(selectedAudit.spec)" readonly /></el-form-item>
        <el-form-item label="提交人"><el-input :model-value="selectedAudit.user" readonly /></el-form-item>
        <el-form-item label="提交时间"><el-input :model-value="selectedAudit.time" readonly /></el-form-item>
        <el-form-item label="当前状态"><el-tag :type="(tagType(selectedAudit.status) as any)">{{ selectedAudit.status }}</el-tag></el-form-item>

        <el-divider content-position="left">链接与图片</el-divider>
        <el-form-item label="Takealot 链接">
          <div class="link-row">
            <el-input :model-value="selectedAudit.link !== '#' ? selectedAudit.link : ''" readonly placeholder="未填写" />
            <el-button v-if="selectedAudit.link && selectedAudit.link !== '#'" link type="primary" @click="openUrl(selectedAudit.link, 'Takealot 链接')">打开</el-button>
          </div>
        </el-form-item>
        <el-form-item label="Takealot 售价图">
          <div v-if="selectedAudit.takealotPriceImageUrl" class="image-preview-row">
            <el-image :src="productDevImageSrc(selectedAudit.takealotPriceImageUrl)" fit="cover" class="preview-img" :preview-src-list="[productDevImageSrc(selectedAudit.takealotPriceImageUrl)]" />
          </div>
          <span v-else class="empty-val">—</span>
        </el-form-item>
        <el-form-item label="亚马逊链接">
          <div class="link-row">
            <el-input :model-value="selectedAudit.amazonUrl || ''" readonly placeholder="未填写" />
            <el-button v-if="selectedAudit.amazonUrl" link type="primary" @click="openUrl(selectedAudit.amazonUrl, '亚马逊链接')">打开</el-button>
          </div>
        </el-form-item>
        <el-form-item label="1688 链接">
          <div class="link-row">
            <el-input :model-value="selectedAudit.alibaba1688Url || ''" readonly placeholder="未填写" />
            <el-button v-if="selectedAudit.alibaba1688Url" link type="primary" @click="openUrl(selectedAudit.alibaba1688Url, '1688 链接')">打开</el-button>
          </div>
        </el-form-item>
        <el-form-item label="1688 产品图">
          <div v-if="selectedAudit.alibaba1688ImageUrl" class="image-preview-row">
            <el-image :src="productDevImageSrc(selectedAudit.alibaba1688ImageUrl)" fit="cover" class="preview-img" :preview-src-list="[productDevImageSrc(selectedAudit.alibaba1688ImageUrl)]" />
          </div>
          <span v-else class="empty-val">—</span>
        </el-form-item>

        <el-divider content-position="left">尺寸</el-divider>
        <el-form-item label="产品尺寸">
          <el-input :model-value="formatProductDim(selectedAudit)" readonly />
        </el-form-item>
        <el-form-item label="包装尺寸">
          <el-input :model-value="formatPackageDim(selectedAudit)" readonly />
        </el-form-item>
        <el-form-item label="CBM / 体积重">
          <el-input
            :model-value="selectedAudit.cbm
              ? `${selectedAudit.cbm} m³ / ${selectedAudit.volumetricWeightKg || '—'} kg`
              : '—'"
            readonly
          />
        </el-form-item>

        <el-divider content-position="left">价格与物流</el-divider>
        <el-form-item label="采购价格 (RMB)">
          <el-input :model-value="selectedAudit.cost ? `¥ ${selectedAudit.cost}` : '—'" readonly />
        </el-form-item>
        <el-form-item label="市场参考价 (R)">
          <el-input :model-value="selectedAudit.marketPrice ? `R ${selectedAudit.marketPrice}` : '—'" readonly />
        </el-form-item>
        <el-form-item label="售价 RMB">
          <el-input :model-value="selectedAudit.sellPriceRmb ? `¥ ${selectedAudit.sellPriceRmb}` : '—'" readonly />
        </el-form-item>
        <el-form-item label="最高售价 RMB">
          <el-input :model-value="selectedAudit.maxSellPriceRmb ? `¥ ${selectedAudit.maxSellPriceRmb}` : '—'" readonly />
        </el-form-item>
        <el-form-item label="海运渠道">
          <el-input :model-value="displayVal(selectedAudit.seaFreightChannel)" readonly />
        </el-form-item>

        <el-divider content-position="left">利润试算（开发填报）</el-divider>
        <el-form-item label="预估利润">
          <div v-if="auditProfit != null" class="profit-box" :class="{ warn: auditProfit < 0 }">
            <span>¥ {{ auditProfit.toFixed(2) }}</span>
            <span v-if="auditProfitRate != null" class="profit-rate">（利润率 {{ auditProfitRate.toFixed(1) }}%）</span>
            <span class="profit-hint">= 售价 RMB − 采购价格（不含海运/平台费）</span>
          </div>
          <span v-else class="form-tip">开发未填写售价或采购价</span>
        </el-form-item>

        <el-divider content-position="left">其他</el-divider>
        <el-form-item label="选品理由">
          <el-input :model-value="displayVal(selectedAudit.reason)" type="textarea" :rows="2" readonly />
        </el-form-item>
        <el-form-item v-if="selectedAudit.auditRemark" label="审核备注">
          <el-input :model-value="selectedAudit.auditRemark" type="textarea" :rows="2" readonly />
        </el-form-item>

        <el-divider content-position="left">审核操作</el-divider>
        <el-form-item label="计划采购数量">
          <el-input-number v-model="form.purchaseQty" :min="0" :step="100" :disabled="selectedAudit.status !== '待审核' || !canSetQty" style="width:200px" />
          <span class="form-tip">核定计划参考量；采购员实际下单数量、单价、国内运费可以不同，采购审核后同步至货盘定价</span>
        </el-form-item>
        <el-form-item v-if="selectedAudit.status === '待审核'" label="审核意见">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填，通过时可备注说明" />
        </el-form-item>
      </el-form>
    </el-scrollbar>
    <template #footer>
      <el-button @click="dialogVisible = false">关闭</el-button>
      <el-button v-if="selectedAudit?.status === '待审核' && canReject" type="warning" @click="reject">驳回</el-button>
      <el-button v-if="selectedAudit?.status === '待审核' && canApprove" type="primary" @click="approve">审核通过</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.header-actions { display:flex; gap:8px; align-items:center; }
.mono { font-family:var(--font-mono); font-size:12px; }
.page-foot { font-size:11px; color:#8b95a8; margin-top:10px; }
.link-row { display:flex; align-items:center; gap:8px; width:100%; }
.link-row .el-input { flex:1; }
.form-tip { font-size:11px; color:#a39a8c; display:block; margin-top:4px; }
.audit-detail-form :deep(.el-divider__text) { font-size:12px; color:#858a8c; }
.image-preview-row { display:flex; gap:10px; }
.preview-img { width:80px; height:80px; border-radius:6px; border:1px solid #ece6dd; }
.empty-val { color:#b0a89c; font-size:13px; }
.profit-box { font-size:14px; color:#1f9d92; font-weight:600; }
.profit-box.warn { color:#c4782b; }
.profit-rate { margin-left:6px; font-weight:500; }
.profit-hint { display:block; font-size:11px; color:#a39a8c; font-weight:400; margin-top:4px; }
</style>
