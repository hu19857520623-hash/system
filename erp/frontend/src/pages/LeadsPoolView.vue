<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { leadApi } from '@/api/client.js'
import { fmtTime, mapLead, formatLeadContact, looksLikeLeadPhone } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useServerPagination } from '@/composables/useTablePagination.ts'
import { useAsyncIo } from '@/composables/useAsyncIo'
import { downloadLeadsImportTemplate } from '@/constants/importTemplates.ts'
import ListPagination from '@/components/ListPagination.vue'
import DetailSheet from '@/components/ui/DetailSheet.vue'
import { useAppStore } from '@/stores/app'
import { LEAD_SELF_ASSIGN_ROLE_CODES } from '@erp/shared/permissions.catalog'

const app = useAppStore()
const router = useRouter()
const { importCsv } = useAsyncIo()

interface SalesUser {
  id: number
  name: string
  username: string
  isCurrent?: boolean
}

const statusFilter = ref('')
const sourceFilter = ref('')
const assigneeFilter = ref<number | ''>('')
const followSalesFilter = ref('')
const createdRange = ref<[string, string] | null>(null)
const searchQ = ref('')
const salesUsers = ref<SalesUser[]>([])
const followSalesOptions = ref<string[]>([])
const { page, pageSize, total, resetPage } = useServerPagination()

const { loading, items: rawItems, load } = useListLoader(async () => {
  const params: Record<string, string | number> = { page: page.value, pageSize: pageSize.value }
  if (statusFilter.value) params.status = statusFilter.value
  if (sourceFilter.value) params.source = sourceFilter.value
  if (assigneeFilter.value !== '') params.assigneeId = assigneeFilter.value
  if (followSalesFilter.value) params.followSales = followSalesFilter.value
  if (createdRange.value?.length === 2) {
    params.createdAtFrom = createdRange.value[0]
    params.createdAtTo = createdRange.value[1]
  }
  if (searchQ.value.trim()) params.keyword = searchQ.value.trim()
  const res = await leadApi.list(params)
  total.value = res.total ?? 0
  return { items: (res.items || []).map(mapLead) }
})

const leads = computed(() =>
  rawItems.value.map((l) => ({
    ...l,
    id: l.leadNo,
    assignee: l.owner,
    tone: l.statusKey === 'deal' ? 'ok' : l.statusKey === 'following' || l.statusKey === 'recall' ? 'warn' : 'info',
  })),
)

const statusOptions = [
  { value: 'new', label: '新线索' },
  { value: 'following', label: '跟进中' },
  { value: 'recall', label: '需要再次跟进' },
  { value: 'hot', label: '意向高' },
  { value: 'nurture', label: '暂无意向' },
  { value: 'deal', label: '已成交' },
  { value: 'lost', label: '已流失' },
]

const sourceOptions = [
  'Takealot', '官网', '展会', '推荐', '小红书', '抖音', '其他',
]

const dialogVisible = ref(false)
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailData = ref<any>(null)
const newLead = ref({
  leadNo: '',
  company: '',
  contact: '',
  source: 'Takealot',
  assigneeId: null as number | null,
  followSales: '',
  remark: '',
})

async function loadSalesUsers() {
  try {
    const res = await leadApi.assignees()
    salesUsers.value = (res.items || [])
      .map((u: any) => ({
        id: Number(u.id),
        name: u.name || u.realName || u.username,
        username: u.username,
        isCurrent: Boolean(u.isCurrent),
      }))
  } catch {
    const current = app.authenticatedUser
    salesUsers.value = current && LEAD_SELF_ASSIGN_ROLE_CODES.includes(current.roleCode as typeof LEAD_SELF_ASSIGN_ROLE_CODES[number])
      ? [{ id: current.id, name: current.realName || current.username, username: current.username, isCurrent: true }]
      : []
  }
}

async function loadFollowSalesOptions() {
  try {
    const res = await leadApi.followSales()
    followSalesOptions.value = res.items || []
  } catch {
    followSalesOptions.value = []
  }
}

function defaultAssigneeId(): number | null {
  const currentUserId = app.authenticatedUser?.id
  const matched = salesUsers.value.find((u) => u.isCurrent || u.id === currentUserId)
  return matched?.id ?? salesUsers.value[0]?.id ?? null
}

const currentUserIsSales = computed(() =>
  LEAD_SELF_ASSIGN_ROLE_CODES.includes(app.authenticatedUser?.roleCode as typeof LEAD_SELF_ASSIGN_ROLE_CODES[number] || ''),
)

function openNewLead() {
  const current = app.authenticatedUser
  if (
    current &&
    LEAD_SELF_ASSIGN_ROLE_CODES.includes(current.roleCode as typeof LEAD_SELF_ASSIGN_ROLE_CODES[number]) &&
    !salesUsers.value.some(user => user.id === current.id)
  ) {
    salesUsers.value.unshift({
      id: current.id,
      name: current.realName || current.username,
      username: current.username,
      isCurrent: true,
    })
  }
  newLead.value = {
    leadNo: '',
    company: '',
    contact: '',
    source: 'Takealot',
    assigneeId: defaultAssigneeId(),
    followSales: '',
    remark: '',
  }
  dialogVisible.value = true
}

async function submitNewLead() {
  if (!newLead.value.company || !newLead.value.contact) {
    ElMessage.warning('请填写客户名称和联系方式')
    return
  }
  if (!newLead.value.assigneeId) {
    ElMessage.warning('请选择归属运营')
    return
  }
  const ok = await withAction(async () => {
    const contact = newLead.value.contact.trim()
    const payload: Record<string, unknown> = {
      companyName: newLead.value.company,
      contactName: contact,
      contactPhone: looksLikeLeadPhone(contact) ? contact : undefined,
      source: newLead.value.source,
      assigneeId: newLead.value.assigneeId,
      followSales: newLead.value.followSales.trim() || undefined,
      remark: newLead.value.remark,
    }
    const leadNo = newLead.value.leadNo.trim()
    if (leadNo) payload.leadNo = leadNo
    await leadApi.create(payload)
    await Promise.all([load(), loadFollowSalesOptions()])
  }, '线索已创建')
  if (ok) dialogVisible.value = false
}

async function follow(row: any) {
  const leadId = row._raw?.id ?? row.id
  const ok = await withAction(async () => {
    await leadApi.followUp(leadId, { content: '开始跟进', followType: 'phone' })
  }, `已开始跟进「${row.company}」，正在打开我的跟进`)
  if (ok) await router.push('/leads/follow')
}

async function importLeads() {
  const job = await importCsv('线索')
  if (job) await load()
}

function applyFilters() {
  resetPage()
  load()
}

function resetFilters() {
  searchQ.value = ''
  statusFilter.value = ''
  sourceFilter.value = ''
  assigneeFilter.value = ''
  followSalesFilter.value = ''
  createdRange.value = null
  applyFilters()
}

const LEAD_STATUS_LABELS: Record<string, string> = {
  new: '新线索',
  following: '跟进中',
  recall: '需要再次跟进',
  hot: '意向高',
  nurture: '暂无意向',
  deal: '已成交',
  lost: '已流失',
}

const FOLLOW_TYPE_LABELS: Record<string, string> = {
  phone: '电话',
  wechat: '微信',
  email: '邮件',
  visit: '拜访',
  other: '其他',
}

const DEAL_STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  won: '已成交',
  lost: '未成交',
}

function followSituationTitle(row: { situation?: string; latestFollowAt?: string; nextPlan?: string }) {
  return [row.situation, row.latestFollowAt, row.nextPlan ? `下一步：${row.nextPlan}` : '']
    .filter(Boolean)
    .join('\n')
}

const detailFollowSituation = computed(() => {
  const latest = detailData.value?.followUps?.[0]
  if (!latest?.content) return '暂无跟进'
  const parts = [String(latest.content).trim()]
  if (latest.nextPlan) parts.push(`下一步：${latest.nextPlan}`)
  if (latest.createdAt) parts.push(fmtTime(latest.createdAt))
  return parts.filter(Boolean).join(' · ')
})

function money(value: unknown) {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : String(value)
}

async function downloadDealFile(deal: any, att: { id: number; fileName: string }) {
  const leadId = detailData.value?.id
  if (leadId == null) return
  try {
    const { blob, fileName } = await leadApi.downloadDealAttachment(leadId, deal.id, att.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || att.fileName
    a.click()
    URL.revokeObjectURL(url)
  } catch (error: any) {
    ElMessage.error(error?.message || '下载失败')
  }
}

async function detail(row: any) {
  detailVisible.value = true
  detailLoading.value = true
  detailData.value = null
  try {
    const leadId = row._raw?.id
    if (leadId == null) throw new Error('线索 ID 缺失')
    detailData.value = await leadApi.detail(leadId)
  } catch (error: any) {
    detailVisible.value = false
    ElMessage.error(error?.message || '加载线索详情失败')
  } finally {
    detailLoading.value = false
  }
}

watch([page, pageSize], load)
const createFollowSalesOptions = computed(() => {
  const names = new Set(followSalesOptions.value)
  for (const user of salesUsers.value) {
    if (user.name) names.add(user.name)
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

onMounted(async () => {
  await Promise.all([loadSalesUsers(), loadFollowSalesOptions()])
  await load()
})
</script>

<template>
  <div class="leads-pool-page">
    <el-card v-loading="loading">
      <template #header>
        <div class="page-header">
          <span class="page-title">线索池</span>
          <div class="header-actions">
            <el-button type="primary" size="small" @click="openNewLead">新建线索</el-button>
            <el-button size="small" link type="primary" @click="downloadLeadsImportTemplate">下载模板</el-button>
            <el-button size="small" @click="importLeads">导入</el-button>
          </div>
        </div>
      </template>

      <div class="filter-bar">
        <el-input
          v-model="searchQ"
          placeholder="客户名称、线索编号、联系方式"
          clearable
          class="filter-keyword"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        />
        <el-select v-model="sourceFilter" placeholder="全部来源" clearable filterable class="filter-select" @change="applyFilters">
          <el-option v-for="source in sourceOptions" :key="source" :label="source" :value="source" />
        </el-select>
        <el-select v-model="statusFilter" placeholder="全部状态" clearable class="filter-select" @change="applyFilters">
          <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select
          v-model="assigneeFilter"
          placeholder="全部归属运营"
          clearable
          filterable
          class="filter-assignee"
          @change="applyFilters"
        >
          <el-option v-for="user in salesUsers" :key="user.id" :label="user.name" :value="user.id" />
        </el-select>
        <el-select
          v-model="followSalesFilter"
          placeholder="全部跟进销售"
          clearable
          filterable
          class="filter-assignee"
          @change="applyFilters"
        >
          <el-option label="未填写" value="__empty__" />
          <el-option v-for="name in followSalesOptions" :key="name" :label="name" :value="name" />
        </el-select>
        <el-date-picker
          v-model="createdRange"
          type="daterange"
          range-separator="至"
          start-placeholder="创建开始日期"
          end-placeholder="创建结束日期"
          value-format="YYYY-MM-DD"
          class="filter-date"
          @change="applyFilters"
        />
        <el-button type="primary" @click="applyFilters">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <el-table :data="leads" stripe border style="width: 100%" size="small">
        <el-table-column prop="id" label="线索编号" width="140">
          <template #default="{ row }">
            <span style="font-family: var(--font-mono); font-size: 12px">{{ row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="company" label="客户名称" min-width="180" />
        <el-table-column label="联系方式" min-width="160">
          <template #default="{ row }">{{ row.contact || '—' }}</template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="80" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.tone === 'ok' ? 'success' : row.tone === 'warn' ? 'warning' : 'info'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="跟进情况" min-width="200">
          <template #default="{ row }">
            <div class="follow-situation" :title="followSituationTitle(row)">
              <div class="follow-situation-text">{{ row.situation }}</div>
              <div v-if="row.latestFollowAt" class="follow-situation-meta">
                {{ row.latestFollowAt }}<template v-if="row.nextPlan"> · {{ row.nextPlan }}</template>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="assignee" label="归属运营" width="100" />
        <el-table-column label="跟进销售" width="110">
          <template #default="{ row }">{{ row.followSales || '—' }}</template>
        </el-table-column>
        <el-table-column prop="time" label="创建时间" width="120" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="follow(row)">跟进</el-button>
            <el-button link type="primary" size="small" @click="detail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
    </el-card>
  </div>

  <el-dialog
    v-model="detailVisible"
    :title="`线索详情${detailData?.leadNo ? ` · ${detailData.leadNo}` : ''}`"
    width="760px"
    destroy-on-close
    class="erp-detail"
  >
    <div v-loading="detailLoading" class="lead-detail">
      <template v-if="detailData">
        <DetailSheet
          :kicker="detailData.leadNo"
          :title="detailData.companyName || '未命名客户'"
          :subtitle="[formatLeadContact(detailData), detailData.source].filter(Boolean).join(' · ')"
        >
          <template #status>
            <el-tag size="small">{{ LEAD_STATUS_LABELS[detailData.status] || detailData.status || '—' }}</el-tag>
          </template>
        </DetailSheet>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="线索编号">{{ detailData.leadNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ LEAD_STATUS_LABELS[detailData.status] || detailData.status || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="客户名称">{{ detailData.companyName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="归属运营">{{ detailData.assigneeName || '未分配' }}</el-descriptions-item>
          <el-descriptions-item label="跟进销售">{{ detailData.followSales || '—' }}</el-descriptions-item>
          <el-descriptions-item label="联系方式">{{ formatLeadContact(detailData) || '—' }}</el-descriptions-item>
          <el-descriptions-item label="邮箱">{{ detailData.email || '—' }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ detailData.source || '—' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ fmtTime(detailData.createdAt) || '—' }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ fmtTime(detailData.updatedAt) || '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ detailData.remark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="跟进情况" :span="2">{{ detailFollowSituation }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-section-title">跟进记录（{{ detailData.followUps?.length || 0 }}）</div>
        <el-empty v-if="!detailData.followUps?.length" description="暂无跟进记录" :image-size="42" />
        <el-timeline v-else class="follow-timeline">
          <el-timeline-item
            v-for="item in detailData.followUps"
            :key="item.id"
            :timestamp="fmtTime(item.createdAt)"
            placement="top"
          >
            <div class="follow-card">
              <div class="follow-head">
                <strong>{{ FOLLOW_TYPE_LABELS[item.followType] || item.followType || '跟进' }}</strong>
                <span>{{ item.operatorName || '未知操作人' }}</span>
              </div>
              <div>{{ item.content || '—' }}</div>
              <div v-if="item.nextPlan" class="follow-secondary">下一步：{{ item.nextPlan }}</div>
              <div v-if="item.nextFollowAt" class="follow-secondary">下次跟进：{{ fmtTime(item.nextFollowAt) }}</div>
            </div>
          </el-timeline-item>
        </el-timeline>

        <div class="detail-section-title">成交记录（{{ detailData.deals?.length || 0 }}）</div>
        <el-empty v-if="!detailData.deals?.length" description="暂无成交记录" :image-size="42" />
        <el-table v-else :data="detailData.deals" border size="small">
          <el-table-column prop="dealNo" label="成交编号" min-width="130" />
          <el-table-column label="金额" width="110">
            <template #default="{ row }">{{ money(row.dealAmount) }}</template>
          </el-table-column>
          <el-table-column label="成交日期" width="120">
            <template #default="{ row }">{{ fmtTime(row.dealDate).split(' ')[0] }}</template>
          </el-table-column>
          <el-table-column prop="productDesc" label="产品/业务" min-width="140" show-overflow-tooltip />
          <el-table-column label="状态" width="90">
            <template #default="{ row }: { row: { status?: string } }">{{ DEAL_STATUS_LABELS[row.status || ''] || row.status || '—' }}</template>
          </el-table-column>
          <el-table-column label="客户资料" min-width="180">
            <template #default="{ row }: { row: { attachments?: { id: number; fileName: string }[] } }">
              <span v-if="!row.attachments?.length">—</span>
              <div v-else class="deal-files">
                <el-button
                  v-for="att in row.attachments"
                  :key="att.id"
                  link
                  type="primary"
                  size="small"
                  @click="downloadDealFile(row, att)"
                >
                  {{ att.fileName }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </div>
    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="dialogVisible" title="新建线索" width="520px">
    <el-form label-width="96px">
      <el-form-item label="线索编号">
        <el-input v-model="newLead.leadNo" placeholder="留空则自动生成，如 LD-XHS-0099" clearable />
      </el-form-item>
      <el-form-item label="客户名称" required>
        <el-input v-model="newLead.company" placeholder="输入客户名称" />
      </el-form-item>
      <el-form-item label="联系方式" required>
        <el-input v-model="newLead.contact" placeholder="姓名 / 微信 / 手机均可" />
      </el-form-item>
      <el-form-item label="来源">
        <el-select v-model="newLead.source" style="width:100%">
          <el-option label="Takealot" value="Takealot" />
          <el-option label="官网" value="官网" />
          <el-option label="展会" value="展会" />
          <el-option label="推荐" value="推荐" />
          <el-option label="小红书" value="小红书" />
          <el-option label="抖音" value="抖音" />
          <el-option label="其他" value="其他" />
        </el-select>
      </el-form-item>
      <el-form-item label="归属运营" required>
        <el-select
          v-model="newLead.assigneeId"
          placeholder="选择负责跟进的运营"
          style="width:100%"
          filterable
          :disabled="currentUserIsSales"
        >
          <el-option
            v-for="u in salesUsers"
            :key="u.id"
            :label="u.name"
            :value="u.id"
          />
        </el-select>
        <div v-if="currentUserIsSales" style="font-size:11px;color:#909399;margin-top:4px">
          运营账号新建线索时自动归属当前登录人
        </div>
      </el-form-item>
      <el-form-item label="跟进销售">
        <el-select
          v-model="newLead.followSales"
          placeholder="选择或输入跟进销售"
          style="width:100%"
          filterable
          allow-create
          default-first-option
          clearable
        >
          <el-option v-for="name in createFollowSalesOptions" :key="name" :label="name" :value="name" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="newLead.remark" type="textarea" :rows="2" placeholder="备注信息" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitNewLead">确认创建</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-weight: 600; font-size: 15px; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0 14px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-extra-light);
}
.filter-keyword { width: 260px; }
.filter-select { width: 130px; }
.filter-assignee { width: 160px; }
.filter-date { width: 260px; }
.lead-detail { min-height: 180px; }
.detail-section-title {
  margin: 20px 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.follow-timeline { padding-left: 4px; }
.follow-card {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-extra-light);
  font-size: 13px;
  line-height: 1.6;
}
.follow-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
.follow-head span,
.follow-secondary { color: var(--el-text-color-secondary); }
.follow-situation {
  line-height: 1.4;
  min-width: 0;
}
.follow-situation-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.follow-situation-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deal-files { display:flex; flex-direction:column; align-items:flex-start; gap:2px; }
</style>
