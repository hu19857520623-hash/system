<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mingruiApi, warehouseApi } from '@/api/client.js'
import { fmtTime, num } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useAppStore } from '@/stores/app'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'

const app = useAppStore()
const route = useRoute()
const router = useRouter()

const canOrder = computed(() => app.hasPerm('mingrui.order'))
const canSubmitBooking = computed(() => canOrder.value && Boolean(apiMeta.value.bookingConfigured))
const canQueryLogistics = computed(() => Boolean(apiMeta.value.queryConfigured || apiMeta.value.configured))
const queryJobNum = ref('')
const queryTrackingRef = ref('')
const syncing = ref(false)

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  draft: { label: '草稿', tone: 'info' },
  submitted: { label: '已下单', tone: 'warning' },
  booked: { label: '已订舱', tone: 'success' },
  in_transit: { label: '运输中', tone: 'warning' },
  arrived: { label: '已到港', tone: 'success' },
  cancelled: { label: '已取消', tone: 'info' },
}

const statusFilter = ref('')
const keyword = ref('')
const apiMeta = ref<{ configured?: boolean; message?: string }>({})
const dialogVisible = ref(false)
const detailVisible = ref(false)
const selected = ref<any>(null)
const eligiblePos = ref<any[]>([])
const warehouses = ref<any[]>([])
const submitting = ref(false)

const emptyForm = () => ({
  poIds: [] as number[],
  mode: 'lcl' as 'lcl' | 'fcl',
  destWarehouse: '',
  originCity: '深圳',
  destPort: 'Durban',
  packages: 0,
  weightKg: '',
  volumeCbm: '',
  mingruiOrderNo: '',
  trackingRef: '',
  remark: '',
})
const form = ref(emptyForm())

const { loading, items, load } = useListLoader(async () => {
  const res = await mingruiApi.list({
    pageSize: 100,
    status: statusFilter.value || undefined,
    keyword: keyword.value || undefined,
  })
  apiMeta.value = res.api || {}
  return { items: res.items || [], total: res.total }
})

const { page, pageSize, total, pagedItems } = useTablePagination(items)

const draftCount = computed(() => items.value.filter((r) => r.status === 'draft' || r.status === 'submitted').length)
const transitCount = computed(() => items.value.filter((r) => r.status === 'in_transit' || r.status === 'booked').length)
const arrivedCount = computed(() => items.value.filter((r) => r.status === 'arrived').length)

function statusMeta(status: string) {
  return STATUS_MAP[status] || { label: status, tone: 'info' }
}

function fmtDate(v: unknown) {
  if (!v) return '—'
  return String(fmtTime(v)).split(' ')[0]
}

async function loadLookups() {
  const [pos, wh] = await Promise.all([
    mingruiApi.eligiblePos().catch(() => []),
    warehouseApi.list({ type: 'overseas' }).catch(() => []),
  ])
  eligiblePos.value = Array.isArray(pos) ? pos : pos?.items || []
  warehouses.value = Array.isArray(wh) ? wh : wh?.items || []
  if (!form.value.destWarehouse) {
    const dest = warehouses.value.find((w) => String(w.warehouseCode || '').includes('JHB')) || warehouses.value[0]
    if (dest) form.value.destWarehouse = dest.warehouseCode
  }
}

function openCreate(poNo?: string) {
  form.value = emptyForm()
  const dest = warehouses.value.find((w) => String(w.warehouseCode || '').includes('JHB')) || warehouses.value[0]
  if (dest) form.value.destWarehouse = dest.warehouseCode
  if (poNo) {
    const hit = eligiblePos.value.find((p) => p.poNo === poNo)
    if (hit) form.value.poIds = [hit.id]
  }
  dialogVisible.value = true
}

function onPoChange(ids: number[]) {
  const selectedPos = eligiblePos.value.filter((p) => ids.includes(p.id))
  form.value.packages = selectedPos.reduce((sum, p) => sum + Number(p.qty || 0), 0)
}

async function saveDraft() {
  submitting.value = true
  const ok = await withAction(async () => {
    await mingruiApi.create({ ...payload(), submit: false })
    await load()
  }, '草稿已保存')
  submitting.value = false
  if (ok) dialogVisible.value = false
}

async function submitOrder() {
  if (!form.value.poIds.length) {
    ElMessage.warning('请选择要发运的采购单')
    return
  }
  if (!apiMeta.value.configured) {
    ElMessage.warning('明瑞物流尚未接通，请先保存草稿')
    return
  }
  submitting.value = true
  const ok = await withAction(async () => {
    const res = await mingruiApi.create({ ...payload(), submit: true })
    await load()
    return res
  }, '已提交明瑞下单')
  submitting.value = false
  if (ok) dialogVisible.value = false
}

function payload() {
  return {
    poIds: form.value.poIds,
    mode: form.value.mode,
    destWarehouse: form.value.destWarehouse || undefined,
    originCity: form.value.originCity || undefined,
    destPort: form.value.destPort || undefined,
    packages: form.value.packages || undefined,
    weightKg: form.value.weightKg === '' ? undefined : Number(form.value.weightKg),
    volumeCbm: form.value.volumeCbm === '' ? undefined : Number(form.value.volumeCbm),
    mingruiOrderNo: form.value.mingruiOrderNo || undefined,
    trackingRef: form.value.trackingRef || undefined,
    remark: form.value.remark || undefined,
  }
}

async function openDetail(row: any) {
  const detail = await mingruiApi.detail(row.id)
  selected.value = detail
  queryJobNum.value = detail.mingruiOrderNo || ''
  queryTrackingRef.value = detail.trackingRef || ''
  detailVisible.value = true
}

async function submitExisting() {
  if (!selected.value) return
  const ok = await withAction(async () => {
    selected.value = await mingruiApi.submit(selected.value.id)
    await load()
  }, '已提交明瑞下单')
  if (!ok) return
}

async function syncLogistics() {
  if (!selected.value) return
  if (!queryJobNum.value && !queryTrackingRef.value) {
    ElMessage.warning('请填写明瑞工作号或跟踪参考号')
    return
  }
  syncing.value = true
  const ok = await withAction(async () => {
    const updated = await mingruiApi.sync(selected.value.id, {
      jobNum: queryJobNum.value || undefined,
      trackingRef: queryTrackingRef.value || undefined,
    })
    selected.value = updated
    queryJobNum.value = updated.mingruiOrderNo || queryJobNum.value
    queryTrackingRef.value = updated.trackingRef || queryTrackingRef.value
    await load()
  }, '已刷新明瑞物流信息')
  syncing.value = false
  if (ok && selected.value?.apiResult?.message) ElMessage.info(selected.value.apiResult.message)
}

function trackingNodes() {
  const nodes = selected.value?.trackingNodes || selected.value?.logisticsInfo?.trackingNodes || []
  return Array.isArray(nodes) ? nodes : []
}

async function cancelShipment() {
  if (!selected.value) return
  await ElMessageBox.confirm(`确认取消运单 ${selected.value.shipmentNo}？`, '取消下单', { type: 'warning' })
  const ok = await withAction(async () => {
    selected.value = await mingruiApi.cancel(selected.value.id)
    await load()
  }, '已取消')
  if (ok) detailVisible.value = false
}

function infoValue(v: unknown) {
  if (v == null || v === '') return '—'
  return String(v)
}

watch(statusFilter, () => load())

onMounted(async () => {
  await Promise.all([loadLookups(), load()])
  const poNo = String(route.query.poNo || '')
  if (poNo && canOrder.value) {
    openCreate(poNo)
    router.replace({ path: '/mingrui', query: {} })
  }
})
</script>

<template>
  <el-card v-loading="loading" class="mingrui-page">
    <template #header>
      <div class="page-header">
        <div>
          <div class="page-title">明瑞物流下单</div>
          <p class="page-subtitle">采购主管向明瑞物流订舱发运海外仓。接入 AI-OPS 后可按工作号查询跟踪状态、节点轨迹与订单信息。</p>
        </div>
        <div class="header-actions">
          <el-input v-model="keyword" clearable placeholder="运单 / PO / 提单号" style="width:220px" @keyup.enter="load" />
          <el-button @click="load">查询</el-button>
          <el-button v-if="canOrder" type="primary" @click="openCreate()">新建下单</el-button>
        </div>
      </div>
    </template>

    <el-alert
      :type="apiMeta.queryConfigured || apiMeta.configured ? 'success' : 'warning'"
      :closable="false"
      show-icon
      style="margin-bottom:14px"
      :title="apiMeta.message || '明瑞查询接口已接通，但未配置认证密钥。'"
    />

    <div class="bill-summary">
      <div>
        <span>待处理</span>
        <strong>{{ draftCount }}</strong>
      </div>
      <div>
        <span>订舱 / 在途</span>
        <strong>{{ transitCount }}</strong>
      </div>
      <div>
        <span>已到港</span>
        <strong>{{ arrivedCount }}</strong>
      </div>
    </div>

    <el-radio-group v-model="statusFilter" size="small" style="margin-bottom:12px">
      <el-radio-button value="">全部</el-radio-button>
      <el-radio-button value="draft">草稿</el-radio-button>
      <el-radio-button value="submitted">已下单</el-radio-button>
      <el-radio-button value="booked">已订舱</el-radio-button>
      <el-radio-button value="in_transit">运输中</el-radio-button>
      <el-radio-button value="arrived">已到港</el-radio-button>
    </el-radio-group>

    <el-table :data="pagedItems" stripe border size="small">
      <el-table-column prop="shipmentNo" label="运单号" width="150">
        <template #default="{ row }">
          <span class="mono link" @click="openDetail(row)">{{ row.shipmentNo }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="poNos" label="关联采购单" min-width="160">
        <template #default="{ row }"><span class="mono">{{ row.poNos || '—' }}</span></template>
      </el-table-column>
      <el-table-column label="目的仓" width="130">
        <template #default="{ row }">{{ row.destWarehouse || '—' }}</template>
      </el-table-column>
      <el-table-column label="方式" width="80">
        <template #default="{ row }">{{ String(row.mode || 'lcl').toUpperCase() }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="(statusMeta(row.status).tone as any)" size="small">{{ statusMeta(row.status).label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="明瑞单号" width="130">
        <template #default="{ row }"><span class="mono">{{ row.mingruiOrderNo || '待同步' }}</span></template>
      </el-table-column>
      <el-table-column label="物流状态" min-width="140">
        <template #default="{ row }">{{ row.trackingStatus || row.logisticsInfo?.apiMessage || '—' }}</template>
      </el-table-column>
      <el-table-column label="创建" width="110">
        <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">物流信息</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !items.length" description="暂无明瑞运单，采购主管可在打款后下单" />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>

  <el-dialog v-model="dialogVisible" title="明瑞物流下单" width="720px" destroy-on-close>
    <p class="dialog-note">仅采购主管可下单。当前先写入本地运单；明瑞 API 接入后会用同一张单同步订舱与轨迹。</p>
    <el-form label-position="top">
      <div class="expense-form-grid">
        <el-form-item label="关联采购单" required class="span-two">
          <el-select v-model="form.poIds" multiple filterable placeholder="选择已审核/已打款采购单" style="width:100%" @change="onPoChange">
            <el-option
              v-for="p in eligiblePos"
              :key="p.id"
              :label="`${p.poNo} · ${p.productName} · ${p.supplierName}`"
              :value="p.id"
              :disabled="p.booked && !form.poIds.includes(p.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="运输方式">
          <el-radio-group v-model="form.mode">
            <el-radio value="lcl">LCL 拼柜</el-radio>
            <el-radio value="fcl">FCL 整柜</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="目的海外仓">
          <el-select v-model="form.destWarehouse" placeholder="选择海外仓" style="width:100%">
            <el-option
              v-for="w in warehouses"
              :key="w.warehouseCode"
              :label="`${w.warehouseName} (${w.warehouseCode})`"
              :value="w.warehouseCode"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="起运城市">
          <el-input v-model="form.originCity" placeholder="深圳" />
        </el-form-item>
        <el-form-item label="目的港">
          <el-input v-model="form.destPort" placeholder="Durban" />
        </el-form-item>
        <el-form-item label="件数 / 件数合计">
          <el-input-number v-model="form.packages" :min="0" controls-position="right" style="width:100%" />
        </el-form-item>
        <el-form-item label="重量 kg">
          <el-input v-model="form.weightKg" placeholder="可选" />
        </el-form-item>
        <el-form-item label="体积 CBM">
          <el-input v-model="form.volumeCbm" placeholder="可选" />
        </el-form-item>
        <el-form-item label="明瑞工作号">
          <el-input v-model="form.mingruiOrderNo" placeholder="如 SEAE260713941" />
        </el-form-item>
        <el-form-item label="跟踪参考号">
          <el-input v-model="form.trackingRef" placeholder="如 TKL-220" />
        </el-form-item>
        <el-form-item label="备注" class="span-two">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="柜型、提货地址、特殊要求" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button :loading="submitting" @click="saveDraft">保存草稿</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!apiMeta.configured" @click="submitOrder">提交下单</el-button>
    </template>
  </el-dialog>

  <el-drawer v-model="detailVisible" :title="selected ? `明瑞物流信息 · ${selected.shipmentNo}` : '明瑞物流信息'" size="560px" class="erp-detail">
    <template v-if="selected">
      <DetailSheet
        :kicker="selected.shipmentNo"
        :title="infoValue(selected.trackingStatus) === '—' ? '物流信息' : selected.trackingStatus"
        :subtitle="[selected.originCity, selected.destPort || selected.destWarehouse].filter(Boolean).join(' → ')"
      >
        <template #metrics>
          <div class="erp-detail__metric">
            <label>明瑞单号</label>
            <strong class="mono">{{ infoValue(selected.mingruiOrderNo) }}</strong>
          </div>
          <div class="erp-detail__metric">
            <label>提单号</label>
            <strong class="mono">{{ infoValue(selected.blNo) }}</strong>
          </div>
          <div class="erp-detail__metric">
            <label>ETD</label>
            <strong>{{ fmtDate(selected.etd) }}</strong>
          </div>
          <div class="erp-detail__metric">
            <label>ETA</label>
            <strong>{{ fmtDate(selected.eta) }}</strong>
          </div>
        </template>
      </DetailSheet>
      <el-alert
        :type="selected.api?.queryConfigured || selected.api?.configured ? 'success' : 'info'"
        :closable="false"
        show-icon
        style="margin-bottom:14px"
        :title="selected.logisticsInfo?.apiMessage || selected.api?.message"
      />
      <div class="query-box">
        <el-input v-model="queryJobNum" clearable placeholder="明瑞工作号 jobNum，如 SEAE260713941" />
        <el-input v-model="queryTrackingRef" clearable placeholder="跟踪参考号 trackingRef，如 TKL-220" />
        <el-button type="primary" :loading="syncing" :disabled="!canQueryLogistics" @click="syncLogistics">查询物流</el-button>
      </div>
      <div class="info-grid">
        <div><span>柜号</span><strong class="mono">{{ infoValue(selected.containerNo) }}</strong></div>
        <div><span>船名</span><strong>{{ infoValue(selected.vesselName) }}</strong></div>
        <div><span>起运地</span><strong>{{ infoValue(selected.originCity) }}</strong></div>
        <div><span>目的港</span><strong>{{ infoValue(selected.destPort) }}</strong></div>
        <div class="span-two"><span>目的仓</span><strong>{{ infoValue(selected.destWarehouse) }}</strong></div>
        <div class="span-two"><span>关联 PO</span><strong class="mono">{{ infoValue(selected.poNos) }}</strong></div>
        <div class="span-two"><span>跟踪参考号</span><strong class="mono">{{ infoValue(selected.trackingRef) }}</strong></div>
        <div class="span-two"><span>轨迹说明</span><strong>{{ infoValue(selected.trackingDetail) }}</strong></div>
        <div><span>重量 / 体积</span><strong>{{ num(selected.weightKg) || '—' }} kg · {{ num(selected.volumeCbm) || '—' }} CBM</strong></div>
        <div><span>最近同步</span><strong>{{ selected.lastSyncAt ? fmtTime(selected.lastSyncAt) : '尚未同步' }}</strong></div>
      </div>
      <div v-if="trackingNodes().length" class="cargo-block">
        <div class="cargo-title">跟踪节点</div>
        <el-timeline>
          <el-timeline-item
            v-for="(node, idx) in trackingNodes()"
            :key="`${node.eventTime || idx}-${node.status || node.statusName || idx}`"
            :timestamp="node.eventTime || '时间待同步'"
          >
            <strong>{{ node.statusName || node.status || '状态更新' }}</strong>
            <span v-if="node.location" class="node-loc">{{ node.location }}</span>
            <p v-if="node.description" class="node-desc">{{ node.description }}</p>
          </el-timeline-item>
        </el-timeline>
      </div>
      <div v-if="Array.isArray(selected.cargoItems) && selected.cargoItems.length" class="cargo-block">
        <div class="cargo-title">货物明细</div>
        <el-table :data="selected.cargoItems" size="small" border>
          <el-table-column prop="sku" label="SKU" width="110" />
          <el-table-column prop="productName" label="商品" min-width="140" />
          <el-table-column prop="qty" label="数量" width="70" align="right" />
          <el-table-column prop="poNo" label="PO" width="120" />
        </el-table>
      </div>
    </template>
    <template #footer>
      <div class="detail-footer">
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button :loading="syncing" :disabled="!canQueryLogistics" @click="syncLogistics">同步物流信息</el-button>
        <el-button v-if="canSubmitBooking && selected?.status === 'draft'" type="primary" @click="submitExisting">提交下单</el-button>
        <el-button v-if="canOrder && selected && !['arrived','cancelled'].includes(selected.status)" type="danger" plain @click="cancelShipment">取消</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.page-title { font-weight:600; font-size:15px; }
.page-subtitle { margin-top:4px; color:var(--text-muted); font-size:12px; max-width:560px; }
.header-actions { display:flex; gap:8px; align-items:center; }
.mono { font-family: var(--font-mono); font-size:12px; }
.link { color: var(--primary); cursor: pointer; }
.bill-summary {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:1px;
  overflow:hidden;
  margin-bottom:14px;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--border);
}
.bill-summary > div {
  min-height:70px;
  padding:12px 15px;
  background:var(--panel-solid);
}
.bill-summary span { display:block; margin-bottom:6px; color:var(--text-muted); font-size:11px; }
.bill-summary strong { color:var(--text); font-size:15px; font-variant-numeric:tabular-nums; }
.dialog-note {
  margin:0 0 16px;
  padding:10px 12px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--panel-soft);
  color:var(--text-secondary);
  font-size:12px;
}
.expense-form-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:0 16px;
}
.span-two { grid-column:1 / -1; }
.info-grid {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:1px;
  overflow:hidden;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--border);
}
.info-grid > div {
  padding:10px 12px;
  background:var(--panel-solid);
}
.info-grid span { display:block; margin-bottom:4px; color:var(--text-muted); font-size:11px; }
.info-grid strong { font-size:13px; font-weight:600; word-break:break-all; }
.cargo-block { margin-top:16px; }
.cargo-title { margin-bottom:8px; font-size:13px; font-weight:600; }
.query-box { display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; }
.query-box .el-input { flex:1; min-width:180px; }
.node-loc { margin-left:8px; color:var(--text-muted); font-size:12px; }
.node-desc { margin:4px 0 0; color:var(--text-secondary); font-size:12px; }
.detail-footer { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
@media (max-width:680px) {
  .page-header, .header-actions { flex-direction:column; align-items:stretch; }
  .bill-summary, .expense-form-grid, .info-grid { grid-template-columns:1fr; }
  .span-two { grid-column:auto; }
}
</style>
