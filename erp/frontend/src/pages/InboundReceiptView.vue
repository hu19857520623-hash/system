<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { inboundApi } from '@/api/client.js'
import { mapInbound, fmtTime } from '@/api/mappers.ts'
import { withAction } from '@/composables/useListLoader.ts'
import { useAppStore } from '@/stores/app'
import { INBOUND_STATUS } from '@/constants/index.js'
import ListPagination from '@/components/ListPagination.vue'

const app = useAppStore()
const route = useRoute()

type StatusFilter = 'all' | 'in_transit' | 'arrived' | 'receiving' | 'putaway' | 'completed' | 'exception'

const filter = ref<StatusFilter>('all')
const searchQ = ref('')
const page = ref(1)
const pageSize = ref(50)
const listTotal = ref(0)
const loading = ref(false)
const inboundOrders = ref<any[]>([])

const statusCounts = ref({
  all: 0,
  in_transit: 0,
  arrived: 0,
  receiving: 0,
  putaway: 0,
  completed: 0,
  exception: 0,
})

const STATUS_FILTER_QUERY: Record<Exclude<StatusFilter, 'all'>, string> = {
  in_transit: 'pending_receipt',
  arrived: 'arrived',
  receiving: 'receiving',
  putaway: 'pending_putaway',
  completed: 'completed',
  exception: 'exception',
}

/** 从入库备注中剥离入仓号/到货日等系统元数据，得到客户填写备注 */
function parseCustomerRemark(remark?: string | null) {
  const raw = remark || ''
  const userRemark = raw
    .replace(/\[.*?\]/g, '')
    .replace(/入仓:[^\s]+/g, '')
    .replace(/到货:\d{4}-\d{2}-\d{2}/g, '')
    .replace(/海运:[^\s]+/g, '')
    .replace(/承运:[^\s]+/g, '')
    .replace(/运单:[^\s]+/g, '')
    .trim()
  return userRemark
}

function qcStatusLabel(status?: string | null) {
  if (status === 'pass') return '通过'
  if (status === 'fail') return '异常'
  if (status === 'pending') return '待检'
  return status || '—'
}

const filterTabs = computed(() => [
  { value: 'all' as const, label: '全部', count: statusCounts.value.all },
  { value: 'in_transit' as const, label: '在途', count: statusCounts.value.in_transit },
  { value: 'arrived' as const, label: '已到仓', count: statusCounts.value.arrived },
  { value: 'receiving' as const, label: '收货中', count: statusCounts.value.receiving },
  { value: 'putaway' as const, label: '待上架', count: statusCounts.value.putaway },
  { value: 'completed' as const, label: '已入库', count: statusCounts.value.completed },
  { value: 'exception' as const, label: '异常', count: statusCounts.value.exception },
])

function statusTagType(status: string, displayStatus?: string) {
  const key = displayStatus || status
  if (key === 'exception') return 'danger'
  if (key === 'arrived') return 'warning'
  if (key === 'receiving') return 'warning'
  if (key === 'pending_putaway') return 'warning'
  if (key === 'completed') return 'success'
  return 'info'
}

const orderRows = computed(() =>
  inboundOrders.value.map((o) => {
    const raw = o._raw
    const qty = (raw.items || []).reduce((s: number, i: any) => s + (i.expectedQty || 0), 0)
    const skuLabel = raw.items?.length === 1
      ? raw.items[0].sku
      : raw.items?.length ? `${raw.items[0]?.sku} 等 ${raw.items.length} SKU` : '—'
    const displayStatus = raw.displayStatus || raw.status
    const customerRemark = parseCustomerRemark(raw.remark)
    return {
      id: raw.id,
      inboundNo: raw.inboundNo,
      warehouse: raw.warehouseCode,
      warehouseNo: raw.warehouseNo || '',
      sku: skuLabel,
      qty,
      customerCode: raw.omsCustomerCode || '',
      dataSource: raw.dataSource || 'erp',
      dataSourceLabel: raw.dataSourceLabel || 'ERP',
      readOnly: Boolean(raw.readOnly),
      customerRemark: customerRemark || '—',
      poRemark: raw.poRemark || '',
      status: raw.status,
      displayStatus,
      statusLabel: INBOUND_STATUS[displayStatus]?.label || raw.status,
      itemCount: raw.items?.length || 0,
      createdAt: fmtTime(raw.createdAt),
      _raw: raw,
    }
  }),
)

async function refreshCounts() {
  const entries: [keyof typeof statusCounts.value, string | undefined][] = [
    ['all', undefined],
    ['in_transit', 'pending_receipt'],
    ['arrived', 'arrived'],
    ['receiving', 'receiving'],
    ['putaway', 'pending_putaway'],
    ['completed', 'completed'],
    ['exception', 'exception'],
  ]
  try {
    const results = await Promise.all(
      entries.map(([, status]) => inboundApi.list({ pageSize: 1, ...(status ? { status } : {}) })),
    )
    entries.forEach(([key], i) => {
      statusCounts.value[key] = results[i]?.total ?? 0
    })
  } catch {
    // 计数失败不影响列表
  }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, unknown> = { page: page.value, pageSize: pageSize.value }
    if (filter.value !== 'all') {
      params.status = STATUS_FILTER_QUERY[filter.value]
    }
    const q = searchQ.value.trim()
    if (q) params.keyword = q
    const res = await inboundApi.list(params)
    inboundOrders.value = (res.items || []).map((r: any) => ({ ...mapInbound(r), _raw: r }))
    listTotal.value = res.total ?? inboundOrders.value.length
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function reloadAll() {
  await Promise.all([load(), refreshCounts()])
}

watch([filter, page, pageSize], () => load())
watch(searchQ, () => {
  page.value = 1
  load()
})
watch(filter, () => {
  page.value = 1
})

const canReceive = computed(() => app.hasPerm('inbound.receive'))
const canQc = computed(() => app.hasPerm('inbound.qc'))
const canResolve = computed(() => app.hasPerm('inbound.handle_exception') || app.hasPerm('inbound.confirm_diff'))

const qcDialogVisible = ref(false)
const qcOrder = ref<any>(null)
const qcLines = ref<{
  id: number
  sku: string
  productName: string
  spec: string
  expectedQty: number
  actualQty: number
  qcStatus: string
  qcRemark: string
  lineRemark: string
}[]>([])
const qcAcceptDiff = ref(false)
const qcLoading = ref(false)

const qcCustomerRemark = computed(() => parseCustomerRemark(qcOrder.value?.remark) || '—')
const qcExpectedTotal = computed(() =>
  qcLines.value.reduce((sum, l) => sum + (l.expectedQty || 0), 0),
)
const qcActualTotal = computed(() =>
  qcLines.value.reduce((sum, l) => sum + (l.actualQty || 0), 0),
)

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailOrder = ref<any>(null)

const detailCustomerRemark = computed(() => parseCustomerRemark(detailOrder.value?.remark) || '—')
const detailStatusLabel = computed(() => {
  const o = detailOrder.value
  if (!o) return '—'
  const key = o.displayStatus || o.status
  return INBOUND_STATUS[key]?.label || o.status || '—'
})

async function openDetail(row: any) {
  detailVisible.value = true
  detailLoading.value = true
  detailOrder.value = null
  try {
    if (row.readOnly || row._raw?.readOnly || String(row.id).startsWith('oms-')) {
      detailOrder.value = row._raw || row
    } else {
      const data = await inboundApi.detail(row.id)
      detailOrder.value = data
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载详情失败')
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

async function downloadOmsAttachment(inboundNo: string, attachmentId: number, fileName: string) {
  try {
    const { blob, fileName: fn } = await inboundApi.downloadOmsAttachment(inboundNo, attachmentId)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fn || fileName || 'attachment'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e: any) {
    ElMessage.error(e?.message || '下载失败')
  }
}

async function openQc(row: any) {
  qcDialogVisible.value = true
  qcAcceptDiff.value = false
  qcOrder.value = row._raw
  qcLines.value = []
  qcLoading.value = true
  try {
    const data = await inboundApi.detail(row.id)
    qcOrder.value = data
    qcLines.value = (data.items || []).map((item: any) => ({
      id: item.id,
      sku: item.sku,
      productName: item.productName || item.sku,
      spec: item.spec || '',
      expectedQty: item.expectedQty,
      actualQty: item.actualQty ?? item.expectedQty,
      qcStatus: item.qcStatus === 'fail' ? 'fail' : 'pass',
      qcRemark: item.qcRemark || '',
      lineRemark: item.remark || '',
    }))
  } catch (e: any) {
    ElMessage.error(e?.message || '加载清点明细失败')
    qcDialogVisible.value = false
  } finally {
    qcLoading.value = false
  }
}

async function startReceive(row: any) {
  if (!canReceive.value) return
  const ok = await withAction(async () => {
    await inboundApi.startReceive(row.id)
    await reloadAll()
  }, `${row.inboundNo} 已开始收货`)
  if (ok && canQc.value) {
    const fresh = inboundOrders.value.find((o) => o.id === row.id || o._raw?.id === row.id)
    await openQc(fresh ? { id: row.id, _raw: fresh._raw || fresh } : row)
  }
}

async function submitQc() {
  if (!qcOrder.value || !canQc.value) return
  const ok = await withAction(async () => {
    await inboundApi.qc(qcOrder.value.id, {
      acceptDiff: qcAcceptDiff.value,
      items: qcLines.value.map((l) => ({
        id: l.id,
        sku: l.sku,
        actualQty: l.actualQty,
        qcStatus: l.qcStatus,
        qcRemark: l.qcRemark || undefined,
      })),
    })
    await reloadAll()
  }, `${qcOrder.value.inboundNo} 清点已提交`)
  if (ok) qcDialogVisible.value = false
}

async function resolveException(row: any) {
  if (!canResolve.value) return
  const ok = await withAction(async () => {
    await inboundApi.resolveException(row.id)
    await reloadAll()
  }, `${row.inboundNo} 已放行，等待上架`)
  if (ok) reloadAll()
}

onMounted(async () => {
  await reloadAll()
  const inboundId = Number(route.query.inboundId)
  if (inboundId > 0) {
    await openDetail({ id: inboundId })
  }
})
</script>

<template>
  <el-card>
    <template #header>
      <div class="page-header">
        <span class="page-title">入库单管理</span>
        <span v-if="statusCounts.all" class="page-meta">共 {{ statusCounts.all }} 单</span>
      </div>
    </template>

    <div class="callout info">
      <div class="callout-title">已到仓收货 · 清点 → 待上架</div>
      <div class="callout-body">含 ERP 发运入库与 OMS 客户预约入库。OMS 草稿/未同步单仅可查看；已同步至 ERP 的单据可正常收货上架。</div>
    </div>

    <div class="filter-row">
      <el-radio-group v-model="filter" size="small">
        <el-radio-button v-for="tab in filterTabs" :key="tab.value" :value="tab.value">
          {{ tab.label }}<span v-if="tab.count" class="tab-count">({{ tab.count }})</span>
        </el-radio-button>
      </el-radio-group>
      <span class="spacer" />
      <el-input v-model="searchQ" placeholder="入库单号 / 入仓号 / 跟踪号" clearable style="width:220px" size="small" />
    </div>

    <el-table v-loading="loading" :data="orderRows" stripe border size="small">
      <el-table-column prop="inboundNo" label="入库单" width="130">
        <template #default="{ row }"><span class="mono">{{ row.inboundNo }}</span></template>
      </el-table-column>
      <el-table-column label="来源" width="96" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.dataSource === 'erp' ? 'primary' : row.dataSource === 'erp_oms' ? 'success' : 'warning'">
            {{ row.dataSourceLabel }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="customerCode" label="客户" width="96">
        <template #default="{ row }"><span class="mono">{{ row.customerCode || '—' }}</span></template>
      </el-table-column>
      <el-table-column prop="warehouse" label="目的仓" width="120">
        <template #default="{ row }"><span class="mono">{{ row.warehouse }}</span></template>
      </el-table-column>
      <el-table-column prop="warehouseNo" label="入仓号" width="110">
        <template #default="{ row }">{{ row.warehouseNo || '—' }}</template>
      </el-table-column>
      <el-table-column prop="sku" label="SKU" min-width="120" />
      <el-table-column label="预期数量" width="90" align="right">
        <template #default="{ row }">{{ row.qty.toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="customerRemark" label="客户备注" min-width="140" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="创建时间" width="130" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status, row.displayStatus)" size="small">{{ row.statusLabel }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          <template v-if="!row.readOnly">
          <el-button
            v-if="row.status === 'arrived' && canReceive"
            link type="primary" size="small"
            @click="startReceive(row)"
          >开始收货</el-button>
          <el-button
            v-if="(row.status === 'arrived' || row.status === 'receiving') && canQc"
            link type="primary" size="small"
            @click="openQc(row)"
          >提交清点</el-button>
          <span v-if="row.status === 'pending_receipt' || row.status === 'pushed' || row.status === 'pending_push'" class="muted-op">待到仓扫描</span>
          <el-button
            v-if="row.displayStatus === 'exception' && canResolve"
            link type="warning" size="small"
            @click="resolveException(row)"
          >放行上架</el-button>
          </template>
          <span v-else class="muted-op">OMS 待同步</span>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !orderRows.length" description="暂无入库单" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="listTotal" />

    <el-dialog v-model="detailVisible" :title="`入库详情 · ${detailOrder?.inboundNo || ''}`" width="760px" class="inbound-detail-dialog" destroy-on-close>
      <div v-loading="detailLoading">
        <template v-if="detailOrder">
          <el-descriptions :column="3" border size="small" class="detail-desc">
            <el-descriptions-item label="入库单号">
              <span class="mono">{{ detailOrder.inboundNo }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTagType(detailOrder.status, detailOrder.displayStatus)" size="small">
                {{ detailStatusLabel }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="目的仓">
              <span class="mono">{{ detailOrder.warehouseCode || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="入仓号">{{ detailOrder.warehouseNo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="始发仓">
              <span class="mono">{{ detailOrder.sourceWarehouseCode || '—' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="跟踪号">{{ detailOrder.trackingNo || '—' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ fmtTime(detailOrder.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="到仓时间">{{ detailOrder.arrivedAt ? fmtTime(detailOrder.arrivedAt) : '—' }}</el-descriptions-item>
            <el-descriptions-item label="客户备注" :span="3">
              <span class="remark-text">{{ detailCustomerRemark }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="detail-section-title">明细</div>
          <el-table :data="detailOrder.items || []" border size="small">
            <el-table-column prop="sku" label="SKU" width="120">
              <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
            </el-table-column>
            <el-table-column prop="productName" label="品名" min-width="140" show-overflow-tooltip />
            <el-table-column prop="spec" label="规格" width="88" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '—' }}</template>
            </el-table-column>
            <el-table-column label="预期" width="80" align="right">
              <template #default="{ row }">{{ row.expectedQty ?? 0 }}</template>
            </el-table-column>
            <el-table-column label="实收" width="80" align="right">
              <template #default="{ row }">{{ row.actualQty ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="差异" width="70" align="right">
              <template #default="{ row }">{{ row.diffQty ?? 0 }}</template>
            </el-table-column>
            <el-table-column label="QC" width="80">
              <template #default="{ row }">{{ qcStatusLabel(row.qcStatus) }}</template>
            </el-table-column>
            <el-table-column label="行备注" min-width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || row.qcRemark || '—' }}</template>
            </el-table-column>
          </el-table>

          <template v-if="detailOrder.omsAttachments?.length">
            <div class="detail-section-title">OMS 上传附件</div>
            <div class="att-list">
              <button
                v-for="att in detailOrder.omsAttachments"
                :key="att.id"
                type="button"
                class="att-link"
                @click="downloadOmsAttachment(detailOrder.inboundNo, att.id, att.fileName)"
              >
                下载 {{ att.fileName }}
              </button>
            </div>
          </template>
        </template>
      </div>
      <template #footer>
        <el-button type="primary" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="qcDialogVisible"
      :title="`提交清点 · ${qcOrder?.inboundNo || ''}`"
      width="960px"
      class="qc-dialog"
      destroy-on-close
    >
      <template v-if="qcOrder">
        <el-descriptions v-loading="qcLoading" :column="3" border size="small" class="qc-summary">
          <el-descriptions-item label="目的仓">
            <span class="mono">{{ qcOrder.warehouseCode || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="入仓号">{{ qcOrder.warehouseNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="跟踪号">{{ qcOrder.trackingNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="应收合计">{{ qcExpectedTotal.toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="始发仓">
            <span class="mono">{{ qcOrder.sourceWarehouseCode || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="实收合计">
            <strong>{{ qcActualTotal.toLocaleString() }}</strong>
          </el-descriptions-item>
          <el-descriptions-item label="SKU 数">{{ qcLines.length }} 种</el-descriptions-item>
          <el-descriptions-item label="客户备注" :span="3">
            <span class="remark-text">{{ qcCustomerRemark }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <div v-loading="qcLoading" class="qc-table-wrap">
          <el-table :data="qcLines" border size="small" stripe style="width:100%">
            <el-table-column prop="sku" label="SKU" width="118" fixed="left" show-overflow-tooltip>
              <template #default="{ row }"><span class="mono">{{ row.sku }}</span></template>
            </el-table-column>
            <el-table-column prop="productName" label="品名" min-width="150" show-overflow-tooltip />
            <el-table-column prop="spec" label="规格" width="88" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '—' }}</template>
            </el-table-column>
            <el-table-column label="行备注" width="100" show-overflow-tooltip>
              <template #default="{ row }">{{ row.lineRemark || '—' }}</template>
            </el-table-column>
            <el-table-column label="应收" width="72" align="right">
              <template #default="{ row }">{{ row.expectedQty.toLocaleString() }}</template>
            </el-table-column>
            <el-table-column label="实收" width="120" align="center">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.actualQty"
                  :min="0"
                  size="small"
                  controls-position="right"
                  class="qc-qty-input"
                />
              </template>
            </el-table-column>
            <el-table-column label="差异" width="72" align="right">
              <template #default="{ row }">
                <span :class="{ 'diff-warn': row.actualQty !== row.expectedQty }">
                  {{ (row.actualQty - row.expectedQty).toLocaleString() }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="QC" width="96" align="center">
              <template #default="{ row }">
                <el-select v-model="row.qcStatus" size="small" class="qc-status-select">
                  <el-option label="通过" value="pass" />
                  <el-option label="异常" value="fail" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="QC 备注" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.qcRemark" size="small" placeholder="破损说明等" clearable />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
      <div v-if="canResolve" class="qc-footer">
        <el-checkbox v-model="qcAcceptDiff">确认接受数量差异（需主管权限）</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="qcDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitQc">提交清点</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.page-title { font-weight:600; font-size:15px; }
.page-meta { font-size:13px; color:var(--el-text-color-secondary); }
.callout { padding:12px 16px; border-radius:8px; margin-bottom:12px; font-size:13px; }
.callout.info { background:#eef6ff; border:1px solid #c5dff8; color:#3d4f63; }
.callout-title { font-weight:600; margin-bottom:4px; }
.filter-row { display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
.tab-count { margin-left:2px; font-size:11px; opacity:0.85; }
.spacer { flex:1; }
.mono { font-family:var(--font-mono,Consolas,monospace); font-size:12px; }
.qc-footer { margin-top:12px; font-size:13px; }
.qc-summary { margin-bottom: 12px; }
.qc-table-wrap { width: 100%; overflow-x: auto; margin-bottom: 8px; }
.qc-table-wrap :deep(.el-table) { min-width: 880px; }
.qc-qty-input { width: 100%; max-width: 108px; }
.qc-qty-input :deep(.el-input__wrapper) { padding-left: 8px; padding-right: 28px; }
.qc-status-select { width: 100%; }
.diff-warn { color: var(--el-color-warning); font-weight: 600; }
:deep(.qc-dialog) { max-width: 96vw; }
:deep(.qc-dialog .el-dialog__body) { padding-top: 12px; }
.muted-op { color:var(--el-text-color-placeholder); font-size:12px; }
.detail-desc { margin-bottom:16px; }
.detail-section-title { font-weight:600; font-size:13px; margin:4px 0 8px; }
.att-list { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
.att-link { font-size:12px; color:var(--el-color-primary); background:none; border:none; cursor:pointer; padding:0; text-decoration:underline; }
.remark-text { white-space:pre-wrap; word-break:break-word; }
:global(.inbound-detail-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 16px) !important;
  margin: 8px auto !important;
  overflow: hidden;
}
:global(.inbound-detail-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto !important;
}
:global(.inbound-detail-dialog .el-descriptions__cell) { padding: 6px 8px !important; }
:global(.inbound-detail-dialog .el-table .el-table__cell) { padding: 5px 0 !important; }
:global(.inbound-detail-dialog .detail-desc) { margin-bottom: 10px; }
</style>
