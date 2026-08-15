<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { leadApi } from '@/api/client.js'
import { fmtTime, mapLead } from '@/api/mappers.ts'
import { useListLoader, withAction } from '@/composables/useListLoader.ts'
import { useTablePagination } from '@/composables/useTablePagination.ts'
import { useRowActions } from '@/composables/useRowActions'
import ListPagination from '@/components/ListPagination.vue'
import { ROUTE_MAP } from '@/constants/index.js'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const { confirmAction } = useRowActions()
const app = useAppStore()
const tab = ref('mine')
const searchQ = ref('')
const followDialogVisible = ref(false)
const followSaving = ref(false)
const followTarget = ref<any>(null)
const followForm = ref({
  followType: 'phone',
  content: '',
  nextPlan: '',
  nextFollowAt: '',
})

const LEAD_STATUS_MAP: Record<string, { label: string; type: string }> = {
  following: { label: '跟进中', type: 'info' },
  recall: { label: '需再次跟进', type: 'warning' },
  hot: { label: '意向高', type: 'success' },
  won: { label: '成交', type: 'success' },
  invalid: { label: '无效客户', type: 'info' },
  nurture: { label: '暂无意向', type: 'info' },
}

const { loading, items: leads, load } = useListLoader(async () => {
  const res = await leadApi.list({ status: 'following', pageSize: 100 })
  return {
    items: (res.items || []).map((r: any) => {
      const m = mapLead(r)
      const latestFollow = r.followUps?.[0]
      return {
        id: m.leadNo,
        name: m.company,
        channel: m.source || '—',
        owner: m.owner,
        ownerId: m.assigneeId,
        contact: [r.contactName, r.contactPhone].filter(Boolean).join(' / ') || '—',
        status: 'following',
        situation: latestFollow?.content || r.remark || '—',
        remark: r.remark || '—',
        inquiryAt: m.time?.split(' ')[0] || '—',
        latestFollowAt: latestFollow?.createdAt ? fmtTime(latestFollow.createdAt) : '—',
        nextFollowAt: latestFollow?.nextFollowAt ? fmtTime(latestFollow.nextFollowAt) : '—',
        latestFollow,
        _leadId: r.id,
      }
    }),
  }
})

const filtered = computed(() => {
  return leads.value.filter((l) => {
    if (tab.value === 'mine' && l.ownerId !== app.authenticatedUser?.id) return false
    if (tab.value === 'follow' && !['following', 'recall', 'hot'].includes(l.status)) return false
    if (searchQ.value) {
      const q = searchQ.value.toLowerCase()
      if (!l.name.toLowerCase().includes(q) && !l.id.toLowerCase().includes(q)) return false
    }
    return true
  })
})

const { page, pageSize, total, pagedItems, resetPage } = useTablePagination(filtered)
watch([tab, searchQ], resetPage)

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
  followSaving.value = true
  try {
    const ok = await withAction(async () => {
      await leadApi.followUp(followTarget.value._leadId, {
        followType: followForm.value.followType,
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

async function markDeal(row: any) {
  if (!(await confirmAction(`确认将「${row.name}」标记为已成交？`, '标记成交'))) return
  try {
    const { value } = await ElMessageBox.prompt('填写店铺类型（可选）', '成交信息', {
      confirmButtonText: '确认成交',
      cancelButtonText: '取消',
      inputValue: '本土店',
      inputPlaceholder: '例如：本土店、海外仓',
    })
    const ok = await withAction(async () => {
      await leadApi.deal(row._leadId, { productDesc: value?.trim() || '本土店' })
    }, '已标记成交，正在跳转成交管理…')
    if (ok) await router.push(ROUTE_MAP.leads_deals)
  } catch { /* cancelled */ }
}

onMounted(load)
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="page-header">
        <span class="page-title">我的跟进</span>
        <el-input v-model="searchQ" placeholder="搜索线索" clearable style="width:180px" size="small" />
      </div>
    </template>
    <el-tabs v-model="tab" type="card">
      <el-tab-pane label="我的线索" name="mine" />
      <el-tab-pane label="待跟进" name="follow" />
    </el-tabs>
    <el-table :data="pagedItems" stripe border size="small">
      <el-table-column prop="id" label="线索编号" width="140">
        <template #default="{ row }"><span style="font-family:var(--font-mono);font-size:12px">{{ row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="name" label="客户名" width="120" />
      <el-table-column prop="channel" label="渠道" width="80" />
      <el-table-column prop="contact" label="联系方式" width="130" />
      <el-table-column prop="status" label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="(LEAD_STATUS_MAP[row.status]?.type as any) || 'info'" size="small">{{ LEAD_STATUS_MAP[row.status]?.label || row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="situation" label="跟进情况" min-width="140" />
      <el-table-column prop="remark" label="备注" min-width="120" />
      <el-table-column prop="latestFollowAt" label="最近跟进" width="150" />
      <el-table-column prop="nextFollowAt" label="下次跟进" width="150" />
      <el-table-column prop="inquiryAt" label="询盘日期" width="110" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="writeFollow(row)">写跟进</el-button>
          <el-button link type="success" size="small" @click="markDeal(row)">成交</el-button>
        </template>
      </el-table-column>
    </el-table>
    <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total" />
  </el-card>

  <el-dialog
    v-model="followDialogVisible"
    :title="`写跟进 · ${followTarget?.name || ''}`"
    width="560px"
    destroy-on-close
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
</template>

<style scoped>
.page-header { display:flex; align-items:center; justify-content:space-between; }
.page-title { font-weight:600; font-size:15px; }
</style>
