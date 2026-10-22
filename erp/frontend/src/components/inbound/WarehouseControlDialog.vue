<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { inboundApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { userFacingError } from '@erp/shared/user-facing-error'
import { displaySku } from '@erp/shared/sku-display'
import { warehouseControlLabels, warehouseControlDescriptions, warehouseControlOptions, warehouseControlCurrent, warehouseControlLimit, type WarehouseControlKind } from '@/utils/warehouseControl'
import type { WarehouseAttempt } from '@/utils/warehouseOperation'
const props = defineProps<{ modelValue: boolean; inboundId: number | null; initialKind?: WarehouseControlKind; busy: boolean; attempt?: WarehouseAttempt | null; errorText?: string; submitAction: (data: { kind: WarehouseControlKind; order: any; payload: any }) => Promise<boolean>; retryAction: (id: number) => Promise<boolean> }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const app = useAppStore(), order = ref<any>(null), kind = ref<WarehouseControlKind>('reopen-count'), reason = ref(''), itemId = ref<number | null>(null), quantity = ref(1), loading = ref(false), error = ref(''), readFailed = ref(false)
let version = 0
const choices = computed(() => warehouseControlOptions(order.value, permission => app.hasPerm(permission)))
const reducing = computed(() => kind.value.startsWith('reduce-'))
const current = computed(() => warehouseControlCurrent(order.value, kind.value, itemId.value))
const limit = computed(() => warehouseControlLimit(order.value, kind.value, itemId.value))
const selectableItems = computed(() => (order.value?.items || []).filter((item: any) => warehouseControlCurrent(order.value, kind.value, Number(item.id)) > 0 || (props.attempt && Number(item.id) === Number(props.attempt.payload.inboundItemId))))
const locked = computed(() => props.busy || loading.value || !!props.attempt)
async function reload() {
  const request = ++version
  loading.value = true; error.value = ''; readFailed.value = true
  try {
    const data = await inboundApi.detail(Number(props.inboundId))
    if (request !== version || Number(props.inboundId) !== Number(data.id)) return
    order.value = data; readFailed.value = false
    if (!props.attempt && (!itemId.value || !selectableItems.value.some((item: any) => Number(item.id) === itemId.value))) itemId.value = Number(selectableItems.value[0]?.id) || null
  } catch (failure) { if (request === version) error.value = `最新单据未能读取，请重试后处理。${userFacingError(failure)}` }
  finally { if (request === version) loading.value = false }
}
watch(() => props.modelValue, visible => {
  ++version
  if (!visible) return
  order.value = null; reason.value = ''; itemId.value = null; quantity.value = 1
  kind.value = props.initialKind || 'reopen-count'
  if (props.attempt) {
    kind.value = props.attempt.kind as WarehouseControlKind; reason.value = props.attempt.payload.reason || ''; quantity.value = props.attempt.payload.quantity || 1; itemId.value = props.attempt.payload.inboundItemId || null
  }
  void reload()
})
watch(kind, () => { if (!props.attempt) { quantity.value = 1; itemId.value = Number(selectableItems.value[0]?.id) || null } })
async function submit() {
  if (locked.value || !order.value || readFailed.value) return
  error.value = ''
  if (!choices.value.includes(kind.value)) { error.value = '当前状态或岗位不允许此处理，请重新读取单据或返回'; return }
  if (reason.value.trim().length < 2) { error.value = '请填写不少于2个字的实际处理原因'; return }
  if (reducing.value && (!Number.isSafeInteger(quantity.value) || quantity.value <= 0 || quantity.value > limit.value)) { error.value = `减少数量须为1至${limit.value}的整数，请核对最近记录`; return }
  const payload = { expectedVersion: order.value.receivingVersion, reason: reason.value.trim(), ...(reducing.value ? { quantity: quantity.value, expectedCurrent: current.value, ...(kind.value !== 'reduce-carton' ? { inboundItemId: Number(itemId.value) } : {}) } : {}) }
  try { if (await props.submitAction({ kind: kind.value, order: order.value, payload })) emit('update:modelValue', false) }
  catch (failure) { error.value = userFacingError(failure) }
}
async function retry() {
  if (!props.attempt || props.busy) return
  try { if (await props.retryAction(props.attempt.inboundId)) emit('update:modelValue', false) }
  catch (failure) { error.value = userFacingError(failure) }
}
</script>
<template>
  <el-dialog :model-value="modelValue" :title="warehouseControlLabels[kind]" width="660px" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="value => !busy && emit('update:modelValue', value)">
    <el-alert v-if="error || errorText" :title="error || errorText" type="error" :closable="false" />
    <el-alert v-if="attempt" title="原处理结果待核对，已保存原请求。请使用原操作重试，或返回页面查看恢复入口。" type="warning" :closable="false" />
    <div v-loading="loading">
      <el-descriptions v-if="order" :column="2" border size="small" style="margin:12px 0"><el-descriptions-item label="入库单">{{ order.inboundNo }}</el-descriptions-item><el-descriptions-item label="目的仓">{{ order.warehouseCode }}</el-descriptions-item></el-descriptions>
      <el-form label-width="110px">
        <el-form-item label="处理类型"><el-select v-if="choices.includes(kind)" v-model="kind" :disabled="locked"><el-option v-for="option in choices" :key="option" :value="option" :label="warehouseControlLabels[option]" /></el-select><span v-else>{{ warehouseControlLabels[kind] }}（请核对最新状态或原处理）</span></el-form-item>
        <el-alert :title="warehouseControlDescriptions[kind]" type="info" :closable="false" style="margin-bottom:16px" />
        <el-form-item v-if="reducing && kind !== 'reduce-carton'" label="SKU明细"><el-select v-model="itemId" :disabled="locked"><el-option v-for="item in selectableItems" :key="item.id" :value="Number(item.id)" :label="displaySku(item)" /></el-select></el-form-item>
        <el-form-item v-if="reducing" label="当前数量"><span>{{ current }}；本次最多可减少 {{ limit }}</span></el-form-item>
        <el-form-item v-if="reducing && attempt" label="原请求数量"><span>操作前 {{ attempt.payload.expectedCurrent }}；本次减少 {{ attempt.payload.quantity }}。核对时使用原请求，不再次按当前数量减少。</span></el-form-item>
        <el-form-item v-if="reducing" label="减少数量"><el-input-number v-model="quantity" :min="1" :max="attempt ? Math.max(quantity, limit, 1) : Math.max(limit, 1)" :precision="0" :disabled="locked" /></el-form-item>
        <el-form-item label="处理原因" required><el-input v-model="reason" type="textarea" :rows="3" maxlength="500" show-word-limit :disabled="locked" placeholder="填写实际差异、处理结论或更正原因" /></el-form-item>
      </el-form>
    </div>
    <template #footer><el-button :disabled="busy" @click="emit('update:modelValue', false)">{{ attempt ? '返回并核对原操作' : '取消' }}</el-button><el-button :disabled="busy || !!attempt" @click="reload">重新读取单据</el-button><el-button v-if="attempt" type="primary" :loading="busy" @click="retry">核对并重试原操作</el-button><el-button v-else type="primary" :loading="busy" :disabled="loading || readFailed || !order || !choices.includes(kind)" @click="submit">确认{{ warehouseControlLabels[kind] }}</el-button></template>
  </el-dialog>
</template>
