<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { outboundApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { getAccessToken } from '@/auth/tokenStore'
import { userFacingError } from '@erp/shared/user-facing-error'
import { readPackAttempts, savePackAttempt, operatePackAttempt, withPackLock, type PackAttempt } from '@/utils/outboundPacking'

const props = defineProps<{ modelValue: boolean; order: { id: number; outboundNo?: string } | null; canPack: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; success: []; pending: []; progress: [] }>()
const app = useAppStore(), pending = ref<PackAttempt | null>(null), detail = ref<any>(null)
const busy = ref(false), loading = ref(false), error = ref(''), storageError = ref('')
const isPalletized = ref(false), palletInfo = ref('')
const blank = () => ({ lengthCm: '', widthCm: '', heightCm: '', grossWeightKg: '' })
const cartons = ref([blank()])
let generation = 0, mounted = true
onBeforeUnmount(() => { mounted = false;generation++ })
function readPending() {
  try { pending.value = readPackAttempts(localStorage, Number(app.authenticatedUser?.id)).find(r => r.outboundId === props.order?.id) || null;storageError.value = '' }
  catch (e) { pending.value = null;storageError.value = userFacingError(e) }
}
function restoreOriginal() {
  if (!pending.value) return
  detail.value = pending.value.order;isPalletized.value = pending.value.payload.isPalletized;palletInfo.value = pending.value.payload.palletInfo
  cartons.value = pending.value.payload.cartons.map(c => ({ lengthCm: String(c.lengthCm), widthCm: String(c.widthCm), heightCm: String(c.heightCm), grossWeightKg: String(c.grossWeightKg) }))
}
watch(() => [props.modelValue, props.order?.id, app.profileRevision], () => {
  generation++;loading.value = false;error.value = '';detail.value = null;cartons.value = [blank()];isPalletized.value = false;palletInfo.value = ''
  if (!props.modelValue || !props.order) return
  readPending()
  if (storageError.value) return
  if (pending.value) restoreOriginal();else void loadFresh()
})
function context() {
  const actor = Number(app.authenticatedUser?.id), token = getAccessToken(), version = generation, id = props.order?.id
  return { actor, guard: () => {
    if (!mounted || !props.modelValue || id !== props.order?.id || version !== generation || actor !== Number(app.authenticatedUser?.id)
      || !token || token !== getAccessToken() || !props.canPack) throw new Error('账号、岗位或页面已变化，请使用原账号核对已保留的复核请求')
  } }
}
async function loadFresh() {
  if (!props.order || loading.value || busy.value) return
  const version = generation;loading.value = true;error.value = ''
  try {
    const { guard } = context();guard()
    let current = await outboundApi.detail(props.order.id);guard()
    if (current.status === 'picked') { current = await outboundApi.startReview(current.id);guard();emit('progress') }
    detail.value = current
    if (current.status !== 'reviewing') throw new Error('当前单据已不在待复核状态，请返回列表查看原单最新进度')
    isPalletized.value = !!current.isPalletized;palletInfo.value = current.palletInfo || ''
  } catch (e) { if (mounted && version === generation) { error.value = userFacingError(e);emit('progress') } }
  finally { if (mounted && version === generation) loading.value = false }
}
function buildCartons() {
  const rows = detail.value?.omsPreDeduct || cartons.value.some(c => Object.values(c).some(v => v.trim())) ? cartons.value : []
  return rows.map((c, index) => {
    if (Object.values(c).some(v => !v.trim())) throw new Error(`请填写第 ${index + 1} 箱的长、宽、高和毛重；不需要的箱行请先删除`)
    const line = { lengthCm: Number(c.lengthCm), widthCm: Number(c.widthCm), heightCm: Number(c.heightCm), grossWeightKg: Number(c.grossWeightKg) }
    if (![line.lengthCm, line.widthCm, line.heightCm].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(line.grossWeightKg) || line.grossWeightKg < 0) throw new Error(`第 ${index + 1} 箱尺寸须大于零，毛重须不小于零`)
    return line
  })
}
async function run(mode: 'retry' | 'check' | 'cancel') {
  if (!props.order || !props.canPack || busy.value || loading.value || storageError.value) return
  const version = generation, expectedRequest = pending.value?.payload.clientRequestId
  busy.value = true;error.value = ''
  try {
    const { actor, guard } = context()
    await withPackLock(actor, async () => {
      guard();readPending()
      if (storageError.value) throw new Error(storageError.value)
      if (expectedRequest && pending.value?.payload.clientRequestId !== expectedRequest) throw new Error('原请求已由其它页面核对，请返回列表重新读取')
      if (!pending.value) {
        if (mode !== 'retry' || detail.value?.status !== 'reviewing') throw new Error('请重新读取原单复核状态后继续')
        const d = detail.value, attempt: PackAttempt = { outboundId: d.id, outboundNo: d.outboundNo,
          order: { id: d.id, outboundNo: d.outboundNo, status: d.status, needsRelabel: d.needsRelabel, omsPreDeduct: d.omsPreDeduct, omsActualFees: d.omsActualFees },
          payload: { clientRequestId: crypto.randomUUID(), reviewSource: 'pick_list', isPalletized: isPalletized.value, palletInfo: isPalletized.value ? palletInfo.value.trim() : '', cartons: buildCartons() } }
        savePackAttempt(localStorage, actor, attempt);readPending();restoreOriginal()
      }
      const result = await operatePackAttempt(outboundApi, localStorage, actor, pending.value!, mode, guard)
      guard();readPending()
      if (result.outcome === 'unknown') { error.value = '尚未查到原请求的完成记录。可重试原尺寸和重量，或取消原请求；请勿另建复核操作。';emit('pending');return }
      ElMessage.success(result.outcome === 'confirmed' ? '原复核已完成，请查看原单最新状态和实测费用' : '原复核请求已取消，不再接受迟到提交；已完成的作业保持原结果')
      emit('success');emit('update:modelValue', false)
    })
  } catch (e) {
    if (mounted && version === generation) { error.value = userFacingError(e);readPending();if (expectedRequest && !pending.value) detail.value = null;emit('pending') }
  } finally { busy.value = false }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="`复核打包 · ${order?.outboundNo || ''}`" width="min(980px, 94vw)"
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="emit('update:modelValue', $event)">
    <el-alert v-if="error || storageError" :title="error || storageError" type="error" :closable="false" />
    <el-alert v-if="pending" title="原尺寸、重量和打托资料已保存。请查询原结果或重试原资料；取消只终止这次原请求。" type="warning" :closable="false" />
    <p v-if="detail?.needsRelabel">复核完成后进入「待换标」，确认换标后再发运。</p>
    <p v-if="detail?.omsPreDeduct">已预扣 ¥{{ Number(detail.omsPreDeduct.preDeductTotal || 0).toFixed(2) }}，请录入实测外箱尺寸和重量，系统按原收费模板计算实际费用。</p>
    <p v-if="detail?.omsActualFees">已实测实算合计 ¥{{ Number(detail.omsActualFees.actualTotal || 0).toFixed(2) }}</p>
    <el-form v-loading="loading" label-width="80px" :disabled="busy || loading || !!pending || !!storageError || detail?.status !== 'reviewing'">
      <el-form-item label="外箱实测" :required="!!detail?.omsPreDeduct">
        <div>
          <div v-for="(carton, index) in cartons" :key="index" class="carton-row">
            <span>第 {{ index + 1 }} 箱</span>
            <el-input v-model="carton.lengthCm" placeholder="长 cm" /> × <el-input v-model="carton.widthCm" placeholder="宽 cm" /> × <el-input v-model="carton.heightCm" placeholder="高 cm" />
            <el-input v-model="carton.grossWeightKg" placeholder="毛重 kg" />
            <el-button v-if="cartons.length > 1" link type="danger" @click="cartons.splice(index, 1)">删除本箱</el-button>
          </div>
          <el-button link type="primary" @click="cartons.push(blank())">+ 加一箱</el-button>
        </div>
      </el-form-item>
      <el-form-item label="打托"><el-checkbox v-model="isPalletized">已打托</el-checkbox></el-form-item>
      <el-form-item label="打托信息"><el-input v-model="palletInfo" :disabled="!isPalletized" maxlength="500" placeholder="托数、尺寸等（可选）" clearable /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="busy" @click="emit('update:modelValue', false)">{{ pending ? '返回并保留原请求' : '返回' }}</el-button>
      <el-button v-if="pending" :disabled="busy || !canPack || !!storageError" @click="run('check')">查询原复核结果</el-button>
      <el-button v-if="pending" :disabled="busy || !canPack || !!storageError" @click="run('cancel')">取消原复核请求</el-button>
      <el-button v-if="error && !pending && !storageError" :disabled="busy || loading || !canPack" @click="loadFresh">重新读取原单</el-button>
      <el-button type="primary" :loading="busy" :disabled="!canPack || loading || !!storageError || (!pending && detail?.status !== 'reviewing')" @click="run('retry')">{{ pending ? '核对并重试原复核' : detail?.needsRelabel ? '确认复核，去换标' : '确认复核打包' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.carton-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
.carton-row .el-input { width: 90px; }
</style>
