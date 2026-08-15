<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useRouter } from 'vue-router'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { dashboardApi, announcementApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers.ts'
import MetricCard from '@/components/ui/MetricCard.vue'
import DashboardTrendChart from '@/components/ui/DashboardTrendChart.vue'

const app = useAppStore()
const router = useRouter()
const loading = ref(false)
const trendLoading = ref(false)
const trendSeries = ref<{ date: string; receipts: number; receivedQty: number; damagedQty: number }[]>([])

const greetName = computed(() => {
  const h = new Date().getHours()
  const time = h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好'
  return `${time}，${app.currentAccount.name}`
})

const kpis = ref([
  { value: '—', label: '可用库存', tone: '' },
  { value: '—', label: '商品 SKU', tone: '' },
  { value: '—', label: '活跃供应商', tone: '' },
  { value: '—', label: '线索总数', tone: '' },
  { value: '—', label: '待审 PO', tone: 'warn' },
  { value: '—', label: '待审选品', tone: 'warn' },
  { value: '—', label: '同步失败', tone: 'warn' },
])

const quickEntries = ref([
  { id: 'leads_pool', icon: 'leads_pool', label: '线索池' },
  { id: 'products', icon: 'products', label: '商品主数据' },
  { id: 'purchase', icon: 'purchase', label: '采购订单' },
  { id: 'inbound_arrival', icon: 'inbound_arrival', label: '到仓扫描' },
  { id: 'inbound', icon: 'inbound', label: '入库单管理' },
  { id: 'inbound_putaway', icon: 'inbound_putaway', label: '入库上架' },
  { id: 'outbound', icon: 'outbound', label: '出库作业' },
  { id: 'billing', icon: 'billing', label: '客户结算' },
])

const pipelineDomestic = ref([
  { label: '选品审核', count: '—', cls: '' },
  { label: '采购/财务', count: '—', cls: '' },
  { label: '中转仓收货', count: '—', cls: '' },
])

const pipelineOverseas = ref([
  { label: '在途待扫描', count: '—', cls: '' },
  { label: '已到仓待收', count: '—', cls: '' },
  { label: '待上架', count: '—', cls: '' },
  { label: '待出库', count: '—', cls: '' },
])

const todos = ref<{ title: string; desc: string; screen: string }[]>([])

const announcements = ref<{
  id: string
  title: string
  category: string
  targetChannel: 'erp' | 'oms'
  status: string
  time: string
  text: string
  scheduledAt?: string | null
  expiresAt?: string | null
  publishedAt?: string | null
  displayPhase: 'active' | 'scheduled' | 'expired'
}[]>([])

const publishDialogVisible = ref(false)
const publishSaving = ref(false)
const newAnnouncement = ref({
  title: '',
  category: '系统',
  text: '',
  targetChannel: 'erp' as 'erp' | 'oms',
  publishMode: 'immediate' as 'immediate' | 'scheduled',
  scheduledAt: '',
  durationMode: 'forever' as 'forever' | 'custom',
  expiresAt: '',
})

const TARGET_LABEL: Record<string, string> = {
  erp: '内部 ERP',
  oms: 'OMS',
}

function mapAnnouncementRow(a: any, phase: 'active' | 'scheduled' | 'expired' = 'active') {
  const publishedAt = a.publishedAt || null
  const scheduledAt = a.scheduledAt || null
  const expiresAt = a.expiresAt || null
  const displayTime = publishedAt || scheduledAt || a.createdAt
  return {
    id: String(a.id),
    title: a.title,
    category: a.category || '系统',
    targetChannel: a.targetChannel === 'oms' ? 'oms' : 'erp',
    status: a.status || 'published',
    time: fmtTime(displayTime).split(' ')[0],
    text: a.content,
    scheduledAt,
    expiresAt,
    publishedAt,
    displayPhase: phase,
  } as const
}

function buildAnnouncementPayload(form: {
  title: string
  category: string
  text: string
  targetChannel: 'erp' | 'oms'
  publishMode: 'immediate' | 'scheduled'
  scheduledAt: string
  durationMode: 'forever' | 'custom'
  expiresAt: string
}) {
  const payload: Record<string, unknown> = {
    title: form.title,
    category: form.category,
    content: form.text,
    targetChannel: form.targetChannel,
    status: 'published',
    publishMode: form.publishMode,
  }
  if (form.publishMode === 'scheduled') {
    if (!form.scheduledAt) throw new Error('请选择计划发布时间')
    payload.scheduledAt = form.scheduledAt
  } else {
    payload.scheduledAt = null
  }
  if (form.durationMode === 'custom') {
    if (!form.expiresAt) throw new Error('请选择公告结束时间')
    payload.expiresAt = form.expiresAt
  } else {
    payload.expiresAt = null
  }
  return payload
}

function announcementScheduleHint(ann: { displayPhase: string; scheduledAt?: string | null; expiresAt?: string | null }) {
  const parts: string[] = []
  if (ann.displayPhase === 'scheduled' && ann.scheduledAt) {
    parts.push(`计划发布：${fmtTime(ann.scheduledAt)}`)
  }
  if (ann.expiresAt) {
    parts.push(`有效期至：${fmtTime(ann.expiresAt)}`)
  }
  return parts.join(' · ')
}

async function loadTrends() {
  trendLoading.value = true
  try {
    const res = await dashboardApi.trends(7)
    trendSeries.value = res?.series ?? []
  } catch {
    trendSeries.value = []
  } finally {
    trendLoading.value = false
  }
}

async function loadDashboard() {
  loading.value = true
  try {
    const [stats, anns, scheduledRes, notif] = await Promise.all([
      dashboardApi.stats(),
      dashboardApi.announcements(),
      app.hasPerm('permissions.manage')
        ? announcementApi.list({ status: 'scheduled', targetChannel: 'erp', pageSize: 20 }).catch(() => ({ items: [] }))
        : Promise.resolve({ items: [] }),
      dashboardApi.notifications().catch(() => ({ items: [], badges: {} })),
    ])
    kpis.value = [
      { value: String(stats.inventoryAvailable ?? 0), label: '可用库存', tone: '' },
      { value: String(stats.products ?? 0), label: '商品 SKU', tone: '' },
      { value: String(stats.suppliers ?? 0), label: '活跃供应商', tone: '' },
      { value: String(stats.leads ?? 0), label: '线索总数', tone: '' },
      { value: String(stats.pendingPo ?? 0), label: '待审 PO', tone: 'warn' },
      { value: String(stats.pendingAudit ?? 0), label: '待审选品', tone: 'warn' },
      { value: String(stats.syncFailed ?? 0), label: '同步失败', tone: stats.syncFailed ? 'warn' : '' },
    ]

    const badge = notif.badges || {}
    pipelineDomestic.value = [
      { label: '选品审核', count: `${stats.pendingAudit ?? 0} 待审`, cls: stats.pendingAudit ? 'warn' : '' },
      { label: '采购/财务', count: `${stats.pendingPo ?? 0} PO`, cls: stats.pendingPo ? 'warn' : '' },
      { label: '中转仓收货', count: `${badge.logistics_wh ?? 0} PO`, cls: badge.logistics_wh ? 'warn' : '' },
    ]
    pipelineOverseas.value = [
      { label: '在途待扫描', count: `${badge.inbound_in_transit ?? 0} 单`, cls: badge.inbound_in_transit ? 'warn' : '' },
      { label: '已到仓待收', count: `${badge.inbound_arrived ?? 0} 单`, cls: badge.inbound_arrived ? 'warn' : '' },
      { label: '待上架', count: `${badge.inbound_putaway ?? 0} 单`, cls: badge.inbound_putaway ? 'warn' : '' },
      { label: '待出库', count: `${badge.outbound ?? 0} 单`, cls: badge.outbound ? 'warn' : '' },
    ]

    todos.value = (notif.items || [])
      .filter((item: any) => item.count > 0 && app.canViewScreen(item.screenId))
      .slice(0, 6)
      .map((item: any) => ({
        title: item.title,
        desc: `${item.count} 项待处理`,
        screen: item.screenId,
      }))

    if (!todos.value.length) {
      todos.value = [
        { title: '暂无待办', desc: '当前没有需要处理的事项', screen: 'dashboard' },
      ]
    }

    const activeRows = (anns || []).map((a: any) => mapAnnouncementRow(a, 'active'))
    const scheduledRows = (scheduledRes?.items || []).map((a: any) => mapAnnouncementRow(a, 'scheduled'))
    announcements.value = [...scheduledRows, ...activeRows]
  } catch (e: any) {
    ElMessage.error(e?.message || '加载工作台数据失败')
  } finally {
    loading.value = false
  }
}

function openPublishDialog() {
  newAnnouncement.value = {
    title: '',
    category: '系统',
    text: '',
    targetChannel: 'erp',
    publishMode: 'immediate',
    scheduledAt: '',
    durationMode: 'forever',
    expiresAt: '',
  }
  publishDialogVisible.value = true
}

async function publishAnnouncement() {
  if (!newAnnouncement.value.title || !newAnnouncement.value.text) {
    ElMessage.warning('请填写公告标题和正文')
    return
  }
  publishSaving.value = true
  try {
    const payload = buildAnnouncementPayload(newAnnouncement.value)
    const res = await announcementApi.create(payload)
    publishDialogVisible.value = false
    if (res?.scheduled) {
      ElMessage.success(`公告已保存，将于 ${fmtTime(res.scheduledAt)} 自动发布`)
    } else if (newAnnouncement.value.targetChannel === 'oms' || res?.omsSynced) {
      ElMessage.success('公告已推送至 OMS（可在同步日志查看）')
    } else {
      ElMessage.success('公告已发布至内部 ERP')
    }
    await loadDashboard()
  } catch (e: any) {
    ElMessage.error(e?.message || '发布失败')
  } finally {
    publishSaving.value = false
  }
}

const editDialogVisible = ref(false)
const editSaving = ref(false)
const editingAnnouncement = ref<any>(null)

function editAnnouncement(ann: any) {
  editingAnnouncement.value = {
    ...ann,
    publishMode: ann.displayPhase === 'scheduled' || ann.status === 'scheduled' ? 'scheduled' : 'immediate',
    scheduledAt: ann.scheduledAt || '',
    durationMode: ann.expiresAt ? 'custom' : 'forever',
    expiresAt: ann.expiresAt || '',
  }
  editDialogVisible.value = true
}

async function saveAnnouncement() {
  if (!editingAnnouncement.value) return
  editSaving.value = true
  try {
    const payload = buildAnnouncementPayload(editingAnnouncement.value)
    await announcementApi.update(editingAnnouncement.value.id, payload)
    editDialogVisible.value = false
    ElMessage.success('公告已更新')
    await loadDashboard()
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    editSaving.value = false
  }
}

async function deleteAnnouncement(ann: { id: string }) {
  try {
    await announcementApi.remove(ann.id)
    ElMessage.success('公告已删除')
    await loadDashboard()
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}

const ICONS: Record<string, string> = {
  leads_pool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7z"/><path d="M3 8.5 12 14l9-5.5M12 14v7"/></svg>',
  purchase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M9 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/><path d="M9 12h6M9 16h4"/></svg>',
  inbound_arrival: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 7h18"/><path d="M5 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/><path d="M7 11h.01M7 15h.01M11 11h.01M11 15h.01M15 11h.01M15 15h.01"/><path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7"/></svg>',
  inbound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 21V9"/><path d="m7 14 5 5 5-5"/><path d="M5 3h14"/></svg>',
  inbound_putaway: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M4 19h16"/><path d="m4 15 4-4 4 4 8-8 4 4"/><path d="M4 11V5h16v6"/></svg>',
  outbound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  billing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>',
}

function navigateTo(id: string) {
  const map: Record<string, string> = {
    leads_pool: '/leads/pool', products: '/products', purchase: '/purchase',
    inbound_arrival: '/inbound/arrival-scan',
    inbound: '/inbound/receipt', inbound_putaway: '/inbound/arrival-scan?step=putaway', outbound: '/outbound',
    billing: '/billing', reports: '/profit-analysis', profit_analysis: '/profit-analysis',
    product_audit: '/product-audit', sync: '/sync', create_inbound: '/inbound/receipt',
    logistics_wh: '/logistics-wh', dashboard: '/dashboard',
  }
  if (map[id]) router.push(map[id])
}

onMounted(() => {
  loadDashboard()
  loadTrends()
})
</script>

<template>
  <div v-loading="loading" class="dashboard">
    <div class="greeting-card">
      <div class="greeting-copy">
        <span class="hero-eyebrow">OPERATIONS COMMAND CENTER</span>
        <h3>{{ greetName }}</h3>
        <p>Takealot 南非海外仓经营系统 · JHB 仓运营中</p>
      </div>
      <div class="hero-status">
        <span class="hero-status-dot"></span>
        <span>系统运行正常</span>
      </div>
    </div>

    <div class="kpi-strip">
      <MetricCard
        v-for="(kpi, index) in kpis"
        :key="kpi.label"
        :value="kpi.value"
        :label="kpi.label"
        :tone="kpi.tone"
        :index="index"
      />
    </div>

    <DashboardTrendChart :series="trendSeries" :loading="trendLoading" />

    <div class="section-title">快捷入口</div>
    <div class="quick-grid">
      <div
        v-for="entry in quickEntries"
        v-show="app.canViewScreen(entry.id)"
        :key="entry.id"
        class="quick-entry"
        @click="navigateTo(entry.id)"
      >
        <span class="nav-ico" v-html="ICONS[entry.id]"></span>
        <span>{{ entry.label }}</span>
      </div>
    </div>

    <div class="section-title">业务流水线</div>
    <div class="pipeline-grid">
      <div class="pipeline-block">
        <div class="pipeline-block-head">
          <span class="pipeline-block-title">国内供应链</span>
          <span class="pipeline-block-desc">选品 → 实际采购同步成本 → 中转仓</span>
        </div>
        <div class="pipeline-card">
          <div class="pipeline-steps">
            <div v-for="step in pipelineDomestic" :key="step.label" class="pipe-step">
              <div class="pipe-dot" :class="step.cls">{{ step.count }}</div>
              <div class="pipe-label">{{ step.label }}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="pipeline-block">
        <div class="pipeline-block-head">
          <span class="pipeline-block-title">海外仓作业</span>
          <span class="pipeline-block-desc">发运 → 海运回传 → 定价 → OMS</span>
        </div>
        <div class="pipeline-card">
          <div class="pipeline-steps">
            <div v-for="step in pipelineOverseas" :key="step.label" class="pipe-step">
              <div class="pipe-dot" :class="step.cls">{{ step.count }}</div>
              <div class="pipe-label">{{ step.label }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">待办事项</div>
        <div class="card-body">
          <div
            v-for="todo in todos"
            :key="todo.title"
            class="todo-item"
            :class="{ muted: todo.screen === 'dashboard' }"
            @click="todo.screen !== 'dashboard' && navigateTo(todo.screen)"
          >
            <div class="todo-title">{{ todo.title }}</div>
            <div class="todo-desc">{{ todo.desc }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          系统公告
          <el-button v-if="app.hasPerm('permissions.manage')" type="primary" size="small" @click="openPublishDialog">发布公告</el-button>
        </div>
        <div class="card-body">
          <el-empty v-if="!announcements.length" description="暂无公告" :image-size="48" />
          <div v-for="ann in announcements" :key="ann.id" class="announce-item" :class="{ 'announce-item--scheduled': ann.displayPhase === 'scheduled' }">
            <div class="announce-head">
              <span class="announce-title">{{ ann.title }}</span>
              <el-tag size="small" type="info">{{ ann.category }}</el-tag>
              <el-tag v-if="ann.displayPhase === 'scheduled'" size="small" type="warning">待发布</el-tag>
              <el-tag size="small" :type="ann.targetChannel === 'oms' ? 'warning' : 'success'">{{ TARGET_LABEL[ann.targetChannel] }}</el-tag>
              <span class="announce-time">{{ ann.time }}</span>
              <span v-if="app.hasPerm('permissions.manage')" class="announce-actions">
                <el-button link type="primary" size="small" @click="editAnnouncement(ann)">编辑</el-button>
                <el-button link type="danger" size="small" @click="deleteAnnouncement(ann)">删除</el-button>
              </span>
            </div>
            <div v-if="announcementScheduleHint(ann)" class="announce-meta">{{ announcementScheduleHint(ann) }}</div>
            <div class="announce-text">{{ ann.text }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <el-dialog v-model="publishDialogVisible" title="发布系统公告" width="520px">
    <el-form label-width="88px">
      <el-form-item label="发布至" required>
        <el-radio-group v-model="newAnnouncement.targetChannel">
          <el-radio value="erp">内部 ERP</el-radio>
          <el-radio value="oms">OMS</el-radio>
        </el-radio-group>
        <div class="field-hint">
          {{ newAnnouncement.targetChannel === 'oms'
            ? '推送至 OMS，不在本工作台展示；记录写入同步日志。'
            : '发布至本系统工作台「系统公告」区域。' }}
        </div>
      </el-form-item>
      <el-form-item label="公告标题">
        <el-input v-model="newAnnouncement.title" maxlength="30" placeholder="例如：JHB 仓盘点通知" />
      </el-form-item>
      <el-form-item label="公告分类">
        <el-select v-model="newAnnouncement.category" style="width:100%">
          <el-option label="系统" value="系统" />
          <el-option label="运营" value="运营" />
          <el-option label="仓库" value="仓库" />
          <el-option label="财务" value="财务" />
        </el-select>
      </el-form-item>
      <el-form-item label="公告正文">
        <el-input v-model="newAnnouncement.text" type="textarea" :rows="4" maxlength="300" placeholder="请填写公告内容、影响范围和时间安排" show-word-limit />
      </el-form-item>
      <el-form-item label="发布时间">
        <el-radio-group v-model="newAnnouncement.publishMode">
          <el-radio value="immediate">立即发布</el-radio>
          <el-radio value="scheduled">定时发布</el-radio>
        </el-radio-group>
        <el-date-picker
          v-if="newAnnouncement.publishMode === 'scheduled'"
          v-model="newAnnouncement.scheduledAt"
          type="datetime"
          placeholder="选择计划发布时间"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss"
          style="width:100%;margin-top:8px"
        />
      </el-form-item>
      <el-form-item label="持续时间">
        <el-radio-group v-model="newAnnouncement.durationMode">
          <el-radio value="forever">永久有效</el-radio>
          <el-radio value="custom">设置结束时间</el-radio>
        </el-radio-group>
        <el-date-picker
          v-if="newAnnouncement.durationMode === 'custom'"
          v-model="newAnnouncement.expiresAt"
          type="datetime"
          placeholder="选择公告结束时间"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss"
          style="width:100%;margin-top:8px"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="publishDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="publishSaving" @click="publishAnnouncement">
        {{ newAnnouncement.targetChannel === 'oms' ? '推送至 OMS' : '发布至 ERP' }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="editDialogVisible" title="编辑系统公告" width="520px">
    <el-form v-if="editingAnnouncement" label-width="88px">
      <el-form-item label="公告标题">
        <el-input v-model="editingAnnouncement.title" maxlength="30" />
      </el-form-item>
      <el-form-item label="公告分类">
        <el-select v-model="editingAnnouncement.category" style="width:100%">
          <el-option label="系统" value="系统" />
          <el-option label="运营" value="运营" />
          <el-option label="仓库" value="仓库" />
          <el-option label="财务" value="财务" />
        </el-select>
      </el-form-item>
      <el-form-item label="公告正文">
        <el-input v-model="editingAnnouncement.text" type="textarea" :rows="4" maxlength="300" show-word-limit />
      </el-form-item>
      <el-form-item label="发布时间">
        <el-radio-group v-model="editingAnnouncement.publishMode">
          <el-radio value="immediate">立即发布</el-radio>
          <el-radio value="scheduled">定时发布</el-radio>
        </el-radio-group>
        <el-date-picker
          v-if="editingAnnouncement.publishMode === 'scheduled'"
          v-model="editingAnnouncement.scheduledAt"
          type="datetime"
          placeholder="选择计划发布时间"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss"
          style="width:100%;margin-top:8px"
        />
      </el-form-item>
      <el-form-item label="持续时间">
        <el-radio-group v-model="editingAnnouncement.durationMode">
          <el-radio value="forever">永久有效</el-radio>
          <el-radio value="custom">设置结束时间</el-radio>
        </el-radio-group>
        <el-date-picker
          v-if="editingAnnouncement.durationMode === 'custom'"
          v-model="editingAnnouncement.expiresAt"
          type="datetime"
          placeholder="选择公告结束时间"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss"
          style="width:100%;margin-top:8px"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="editDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="editSaving" @click="saveAnnouncement">保存修改</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.greeting-card {
  min-height: 170px;
  padding: 28px 30px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
  border: 1px solid var(--bw-border-strong);
  border-radius: 20px;
  background: var(--bw-hero);
  box-shadow: var(--bw-shadow);
  isolation: isolate;
}
.greeting-card::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  background:
    linear-gradient(var(--bw-hero-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--bw-hero-grid) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: linear-gradient(90deg, transparent 0%, black 48%);
  opacity: 0.9;
}
.greeting-card::after {
  content: '';
  position: absolute;
  width: 240px;
  height: 240px;
  right: 3%;
  top: -150px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  box-shadow:
    0 0 0 28px rgba(255, 255, 255, 0.03),
    0 0 0 56px rgba(255, 255, 255, 0.02);
}
.hero-eyebrow {
  display: block;
  margin-bottom: 12px;
  color: var(--bw-hero-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
}
.greeting-card h3 {
  color: var(--bw-hero-ink);
  font-size: clamp(24px, 3vw, 34px);
  font-weight: 750;
  letter-spacing: -0.04em;
}
.greeting-card p {
  margin-top: 7px;
  color: var(--bw-hero-muted);
  font-size: 13px;
}
.hero-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  position: relative;
  z-index: 1;
  color: var(--bw-status-text);
  background: var(--bw-status-bg);
  border: 1px solid var(--bw-status-border);
  border-radius: 999px;
  font-size: 11px;
}
.hero-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2);
}
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 14px;
  overflow: visible;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 3px 0 -10px;
  color: var(--bw-ink);
  font-size: 15px;
  font-weight: 650;
}
.section-title::before {
  content: '';
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: var(--bw-ink);
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.quick-entry {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  transition: all 0.2s ease;
  min-height: 64px;
  padding: 14px 16px;
  color: var(--bw-ink);
  background: var(--bw-card);
  border: 1px solid var(--bw-border);
  border-radius: 14px;
  box-shadow: var(--bw-shadow);
}
.quick-entry :deep(.nav-ico) {
  width: 34px;
  height: 34px;
  padding: 8px;
  color: var(--bw-ink);
  background: var(--bw-paper);
  border: 1px solid var(--bw-border);
  border-radius: 10px;
}
.quick-entry:hover {
  border-color: var(--bw-border-strong);
  box-shadow: var(--bw-shadow-hover);
  transform: translateY(-2px);
}
.pipeline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.pipeline-grid,
.pipeline-block {
  min-width: 0;
}
.pipeline-block-head {
  margin-bottom: 9px;
}
.pipeline-block-title {
  color: var(--bw-ink);
  font-size: 13px;
  font-weight: 600;
}
.pipeline-block-desc {
  color: var(--bw-muted);
}
.pipeline-card {
  min-height: 106px;
  padding: 20px;
  display: flex;
  align-items: center;
  background: var(--bw-card);
  border: 1px solid var(--bw-border);
  border-radius: 16px;
  box-shadow: var(--bw-shadow);
  min-width: 0;
  max-width: 100%;
}
.pipeline-steps {
  display: flex;
  align-items: center;
  width: 100%;
  justify-content: space-around;
  flex-wrap: nowrap;
}
.pipe-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
  flex: 1;
  padding: 0 14px;
}
.pipe-step:not(:last-child)::after {
  content: '→';
  position: absolute;
  right: -6px;
  top: 8px;
  color: var(--bw-faint);
  font-size: 12px;
}
.pipe-dot {
  font-family: var(--font-mono);
  font-size: 10px;
  border: 1px solid var(--bw-border-strong);
  border-radius: 999px;
  white-space: nowrap;
  color: var(--bw-ink);
  background: var(--bw-paper);
  padding: 2px 8px;
}
.pipe-dot.warn {
  color: var(--bw-ink);
  background: var(--bw-card);
  border-color: var(--bw-ink);
  font-weight: 700;
}
.pipe-label {
  color: var(--bw-muted);
}
.grid-2 {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 16px;
}
.card {
  overflow: hidden;
  background: var(--bw-card);
  border: 1px solid var(--bw-border);
  border-radius: 16px;
  box-shadow: var(--bw-shadow);
}
.card-header {
  padding: 16px 18px;
  color: var(--bw-ink);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--bw-border);
}
.card-body {
  padding: 8px 18px 12px;
}
.todo-item,
.announce-item {
  padding: 13px 2px;
  cursor: pointer;
  border-bottom: 1px solid var(--bw-border);
  transition: background 0.15s ease;
}
.todo-item.muted {
  cursor: default;
}
.todo-item.muted:hover {
  background: transparent;
}
.todo-title {
  font-size: 13px;
  font-weight: 500;
}
.todo-desc {
  font-size: 11px;
  margin-top: 2px;
}
.announce-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.announce-actions {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}
.announce-item--scheduled {
  background: #fffaf0;
}
.announce-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
}
.announce-text {
  font-size: 12px;
  margin-top: 4px;
}
.field-hint {
  font-size: 12px;
  color: var(--bw-muted);
  margin-top: 6px;
  line-height: 1.5;
}
.todo-item:hover {
  background: var(--bw-paper);
}
.todo-title,
.announce-title {
  color: var(--bw-ink);
}
.todo-desc,
.announce-time {
  color: var(--bw-muted);
}
.announce-text {
  color: var(--bw-mid);
}

@media (max-width: 1280px) {
  .kpi-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 840px) {
  .greeting-card {
    min-height: 150px;
    padding: 24px;
  }
  .hero-status {
    display: none;
  }
  .kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .quick-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid-2,
  .pipeline-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .kpi-strip {
    grid-template-columns: 1fr;
  }
  .pipeline-card {
    overflow: hidden;
  }
  .pipeline-steps {
    width: 100%;
    max-width: 100%;
    justify-content: flex-start;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    padding-bottom: 5px;
  }
  .pipe-step {
    min-width: 118px;
  }
  .announce-head {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .announce-time {
    margin-left: 0;
  }
}
</style>
