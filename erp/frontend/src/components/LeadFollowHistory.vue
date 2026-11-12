<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { leadApi } from '@/api/client.js'
import { fmtTime } from '@/api/mappers'
import { leadFollowTypeLabel } from '@/features/leads/leadFollowType'
import { withAction } from '@/composables/useListLoader'
import { useAppStore } from '@/stores/app'

interface FollowUp {
  id: number | string; followType: string; content: string; revision: string
  nextPlan?: string | null; nextFollowAt?: string | null; createdAt?: string; operatorName?: string | null
}
const props = defineProps<{ lead: { id: number | string; followUps?: FollowUp[]; canEditFollowUps?: boolean } }>()
const emit = defineEmits<{ updated: [] }>()
const app = useAppStore()
const editing = ref(false)
const saving = ref(false)
const target = ref<FollowUp | null>(null)
const form = ref({ followType: '', content: '', nextPlan: '', nextFollowAt: '' })
const types = ['phone', 'wechat', 'wecom', 'email', 'visit', 'other']
watch(() => props.lead.id, () => { editing.value = false; target.value = null })

function openEdit(item: FollowUp) {
  if (!props.lead.canEditFollowUps || !app.hasPerm('leads_follow.edit')) return
  target.value = item
  // 空值保留为空，不把历史记录默认为电话。
  form.value = { followType: item.followType || '', content: item.content || '', nextPlan: item.nextPlan || '', nextFollowAt: item.nextFollowAt || '' }
  editing.value = true
}

async function save() {
  if (saving.value || !target.value || !props.lead.canEditFollowUps || !app.hasPerm('leads_follow.edit')) return
  if (!types.includes(form.value.followType)) { ElMessage.warning('请选择跟进方式'); return }
  if (!form.value.content.trim()) { ElMessage.warning('请填写跟进内容'); return }
  saving.value = true
  try {
    const ok = await withAction(async () => {
      await leadApi.updateFollowUp(props.lead.id, target.value!.id, {
        followType: form.value.followType, content: form.value.content.trim(),
        nextPlan: form.value.nextPlan.trim() || null, nextFollowAt: form.value.nextFollowAt || null,
        expectedRevision: target.value!.revision,
      })
    }, '跟进记录已更新')
    if (ok) { editing.value = false; emit('updated') }
  } finally { saving.value = false }
}
</script>

<template>
  <el-empty v-if="!lead.followUps?.length" description="暂无跟进记录" :image-size="42" />
  <el-timeline v-else>
    <el-timeline-item v-for="item in lead.followUps" :key="item.id" :timestamp="fmtTime(item.createdAt)" placement="top">
      <div class="follow-head">
        <strong>{{ leadFollowTypeLabel(item.followType) }}</strong>
        <span>{{ item.operatorName || '未知操作人' }}</span>
        <el-button v-if="lead.canEditFollowUps && app.hasPerm('leads_follow.edit')" link type="primary" size="small" @click="openEdit(item)">编辑</el-button>
      </div>
      <div class="follow-content">{{ item.content || '—' }}</div>
      <div v-if="item.nextPlan" class="follow-secondary">下一步：{{ item.nextPlan }}</div>
      <div v-if="item.nextFollowAt" class="follow-secondary">下次跟进：{{ fmtTime(item.nextFollowAt) }}</div>
    </el-timeline-item>
  </el-timeline>
  <el-dialog v-model="editing" title="编辑跟进记录" width="560px" append-to-body destroy-on-close :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
    <el-form label-width="92px">
      <el-form-item label="跟进方式" required>
        <el-radio-group v-model="form.followType">
          <el-radio v-for="type in types" :key="type" :value="type">{{ leadFollowTypeLabel(type) }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="跟进内容" required><el-input v-model="form.content" type="textarea" :rows="4" maxlength="1000" show-word-limit /></el-form-item>
      <el-form-item label="下一步计划"><el-input v-model="form.nextPlan" type="textarea" :rows="2" maxlength="500" show-word-limit /></el-form-item>
      <el-form-item label="下次跟进"><el-date-picker v-model="form.nextFollowAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" clearable /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="editing = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存修改</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.follow-head { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.follow-content { white-space: pre-wrap; overflow-wrap: anywhere; }
.follow-secondary { color: var(--el-text-color-secondary); margin-top: 6px; white-space: pre-wrap; }
</style>
