<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { leadApi } from '@/api/client.js'
import { mapLead } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { erpConfirm } from '@/utils/messageBox.ts'
import { useServerPagination } from '@/composables/useTablePagination.ts'
import ListPagination from '@/components/ListPagination.vue'
import { ROUTE_MAP } from '@/constants/index.js'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const app = useAppStore()
const tab = ref('mine')
const searchQ = ref('')
const followTimeField = ref<'inquiry' | 'latestFollow' | 'nextFollow'>('inquiry')
const followDateRange = ref<[string, string] | null>(null)

const followDateShortcuts = [
  {
    text: '今天',
    value: () => {
      const today = new Date()
      return [today, today]
    },
  },
  {
    text: '近7天',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setDate(end.getDate() - 6)
      return [start, end]
    },
  },
  {
    text: '本月',
    value: () => {
      const now = new Date()
      return [new Date(now.getFullYear(), now.getMonth(), 1), now]
    },
  },
]
const followDialogVisible = ref(false)
const followSaving = ref(false)
const followTarget = ref<any>(null)
const followForm = ref({
  followType: 'phone',
  content: '',
  nextPlan: '',
  nextFollowAt: '',
})

const SHOP_TYPE_OPTIONS = ['本土店', '跨境店', '海外仓']
const dealDialogVisible = ref(false)
const dealSaving = ref(false)
const dealTarget = ref<any>(null)
const dealShopType = ref('本土店')

const LEAD_STATUS_MAP: Record<string, { label: string; type: string }> = {
  new: { label: '新线索', type: 'info' },
  following: { label: '跟进中', type: 'info' },
  recall: { label: '需要再次跟进', type: 'warning' },
  hot: { label: '意向高', type: 'success' },
  deal: { label: '成交', type: 'success' },
  won: { label: '成交', type: 'success' },
  invalid: { label: '无效客户', type: 'info' },
  lost: { label: '已流失', type: 'info' },
  nurture: { label: '暂无意向', type: 'info' },
}

const { page, pageSize, total, resetPage } = useServerPagination()

const { loading, items: leads, load } = useListLoader(async () => {
  const params: Record<string, string | number> = {
    page: page.value,
    pageSize: pageSize.value,
    statuses: 'new,following',
  }
  const keyword = searchQ.value.trim()
  if (keyword) params.keyword = keyword
  const userId = app.authenticatedUser?.id
  const canViewAll = app.hasPerm('leads_pool.view_all')
  if (tab.value === 'mine' && userId) params.assigneeId = userId
  if (tab.value === 'follow') {
    if (!canViewAll && userId) params.assigneeId = userId
    const range = followDateRange.value
    const hasFollowDate = Boolean(range && range.length === 2)
    if (followTimeField.value !== 'nextFollow' || !hasFollowDate) params.followDue = '1'
    if (range && range.length === 2) {
      const [from, to] = range
      if (followTimeField.value === 'nextFollow') {
        params.nextFollowAtFrom = from
        params.nextFollowAtTo = to
      } else if (followTimeField.value === 'latestFollow') {
        params.latestFollowAtFrom = from
        params.latestFollowAtTo = to
      } else {
        params.createdAtFrom = from
        params.createdAtTo = to
      }
    }
  }
  const res = await leadApi.list(params)
  total.value = res.total ?? 0
  return {
    items: (res.items || []).map((r: any) => {
      const m = mapLead(r)
      return {
        id: m.leadNo,
        name: m.company,
        channel: m.source || '—',
        owner: m.owner,
        ownerId: m.assigneeId,
        contact: m.contact || '—',
        status: r.status || 'following',
        situation: m.situation,
        remark: r.remark || '—',
        inquiryAt: m.time?.split(' ')[0] || '—',
        latestFollowAt: m.latestFollowAt || '—',
        nextFollowAt: m.nextFollowAt || '—',
        latestFollow: r.followUps?.[0],
        _leadId: r.id,
      }
    }),
  }
})

function applyFilters() {
  resetPage()
  load()
}

function resetFollowFilters() {
  followTimeField.value = 'inquiry'
  followDateRange.value = null
  applyFilters()
}

function writeFollow(row: any) {
  followTarget.value = row
  followForm.value = {
    followType: row.latestFollow?.followType || 'phone',
    content: '',
    nextPlan: '',
    nextFollowAt: '',
  }
  followDialogVisible.value = true
}

async function submitFollow() {
  const content = followForm.value.content.trim()
  if (!content) {
    ElMessage.warning('请填写本次跟进内容')
    return
  }
  if (followTarget.value?._leadId == null) {
    ElMessage.error('线索 ID 缺失，请刷新后重试')
    return
  }
  followSaving.value = true
  try {
    const ok = await withAction(async () => {
      await leadApi.followUp(followTarget.value._leadId, {
        followType: followForm.value.followType || 'phone',
        content,
        nextPlan: followForm.value.nextPlan.trim() || undefined,
        nextFollowAt: followForm.value.nextFollowAt || undefined,
      })
      await load()
    }, '跟进记录已保存')
    if (ok) followDialogVisible.value = false
  } finally {
    followSaving.value = false
  }
}

function markDeal(row: any) {
  dealTarget.value = row
  dealShopType.value = '本土店'
  dealDialogVisible.value = true
}

async function submitDeal() {
  const row = dealTarget.value
  const shopType = dealShopType.value
  if (!row?._leadId) return
  if (!SHOP_TYPE_OPTIONS.includes(shopType)) {
    ElMessage.warning('请选择店铺类型')
    return
  }
  dealSaving.value = true
  try {
    const ok = await withAction(async () => {
      await leadApi.deal(row._leadId, { productDesc: shopType })
    }, '已标记成交，正在跳转成交管理…')
    if (ok) {
      dealDialogVisible.value = false
      await router.push(ROUTE_MAP.leads_deals)
    }
  } finally {
    dealSaving.value = false
  }
}

async function markRecall(row: any) {
  if (!row?._leadId) {
    ElMessage.error('线索 ID 缺失，请刷新后重试')
    return
  }
  try {
    await erpConfirm(`将「${row.name}」标记为需要再次跟进并退回线索池？`, '需要再次跟进')
  } catch {
    return
  }
  await withAction(async () => {
    await leadApi.recall(row._leadId)
    await load()
  }, '已退回线索池，状态为需要再次跟进')
}

watch(tab, applyFilters)
watch([page, pageSize], load)
onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">我的跟进</span>
        <el-input
          v-model="searchQ"
          placeholder="搜索线索"
          clearable
          style="width:180px"
          size="small"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        />
      </div>
    </template>
    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="我的线索" name="mine" />
      <el-tab-pane label="待跟进" name="follow" />
    </el-tabs>
    <div v-if="tab === 'follow'" class="filter-bar">
      <el-select v-model="followTimeField" size="small" class="filter-time-field" @change="applyFilters">
        <el-option label="询盘日期" value="inquiry" />
        <el-option label="最近跟进" value="latestFollow" />
        <el-option label="下次跟进" value="nextFollow" />
      </el-select>
      <el-date-picker
        v-model="followDateRange"
        type="daterange"
        unlink-panels
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        :shortcuts="followDateShortcuts"
        clearable
        size="small"
        class="filter-date"
        @change="applyFilters"
      />
      <el-button type="primary" size="small" @click="applyFilters">查询</el-button>
      <el-button size="small" @click="resetFollowFilters">重置</el-button>
    </div>
    <el-table :data="leads" stripe border size="small">
      <el-table-column prop="id" label="线索编号" width="140">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="客户名" width="120" />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column prop="contact" label="联系方式" width="130" />
      <el-table-column prop="status" label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="(LEAD_STATUS_MAP[row.status]?.type as any) || 'info'" size="small">{{ LEAD_STATUS_MAP[row.status]?.label || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="situation" label="跟进情况" min-width="140" />
      <el-table-column prop="remark" label="备注" min-width="120" />
      <el-table-column prop="latestFollowAt" label="最近跟进" width="150" />
      <el-table-column prop="nextFollowAt" label="下次跟进" width="150" />
      <el-table-column prop="inquiryAt" label="询盘日期" width="110" />
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="writeFollow(row)">写跟进</el-button>
          <el-button link type="warning" size="small" @click="markRecall(row)">需要再次跟进</el-button>
          <el-button link type="success" size="small" @click="markDeal(row)">成交</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty
      v-if="!loading && !leads.length"
      :description="tab === 'follow' ? (followDateRange ? '该时间范围内暂无待跟进线索' : '暂无到期待跟进线索') : '当前账号没有归属线索，可在线索池领取后跟进'"
    />
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>

  <el-dialog
    v-model="followDialogVisible"
    :title="`写跟进 · ${followTarget?.name || ''}`"
    width="560px"
    destroy-on-close
    append-to-body
  >
    <el-form label-width="92px">
      <el-form-item label="跟进方式" required>
        <el-radio-group v-model="followForm.followType">
          <el-radio value="phone">电话</el-radio>
          <el-radio value="wechat">微信</el-radio>
          <el-radio value="email">邮件</el-radio>
          <el-radio value="visit">拜访</el-radio>
          <el-radio value="other">其他</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="跟进内容" required>
        <el-input
          v-model="followForm.content"
          type="textarea"
          :rows="4"
          maxlength="1000"
          show-word-limit
          placeholder="填写本次沟通情况、客户反馈等"
        />
      </el-form-item>
      <el-form-item label="下一步计划">
        <el-input
          v-model="followForm.nextPlan"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
          placeholder="例如：发送报价单，确认产品清单"
        />
      </el-form-item>
      <el-form-item label="下次跟进">
        <el-date-picker
          v-model="followForm.nextFollowAt"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss"
          format="YYYY-MM-DD HH:mm"
          placeholder="选择下次跟进时间"
          clearable
          style="width:100%"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="followDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="followSaving" @click="submitFollow">保存跟进</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="dealDialogVisible"
    title="成交信息"
    width="420px"
    destroy-on-close
    append-to-body
  >
    <el-form label-width="92px">
      <el-form-item label="客户">
        <span>{{ dealTarget?.name || '—' }}</span>
      </el-form-item>
      <el-form-item label="店铺类型" required>
        <el-select v-model="dealShopType" placeholder="请选择店铺类型" style="width:100%">
          <el-option v-for="s in SHOP_TYPE_OPTIONS" :key="s" :label="s" :value="s" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dealDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="dealSaving" @click="submitDeal">确认成交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}
.filter-time-field { width: 120px; }
.filter-date { width: 260px; }
</style>
