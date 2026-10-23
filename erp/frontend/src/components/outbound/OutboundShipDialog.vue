<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { outboundApi } from '@/api/client.js'
import { useAppStore } from '@/stores/app'
import { userFacingError } from '@erp/shared/user-facing-error'
import { readShipAttempts, saveShipAttempt, runShipAttempt, type ShipAttempt } from '@/utils/outboundShipping'
const props = defineProps<{
  modelValue: boolean
  order: { id: number; outboundNo?: string; status?: string; trackingNo?: string | null; carrier?: string | null; logisticsProduct?: string | null
    omsActualFees?: { actualTotal?: number } | null; omsPreDeduct?: { preDeductTotal?: number } | null } | null
  canShip: boolean; logisticsProducts: string[]; carriers: string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; success: []; pending: [] }>()
const app = useAppStore(), busy = ref(false), error = ref(''), storageError = ref(''), pending = ref<ShipAttempt | null>(null)
const shipTrackingNo = ref(''), shipCarrier = ref(''), shipLogisticsProduct = ref('')
const recoveryOnly = computed(() => !!props.order?.status && props.order.status !== 'packed')
function readPending() {
  try { pending.value = readShipAttempts(localStorage, Number(app.authenticatedUser?.id)).find(r => r.outboundId === props.order?.id) || null;storageError.value = '' }
  catch (e) { storageError.value = userFacingError(e) }
}
watch(() => props.modelValue, visible => {
  if (!visible || !props.order) return
  error.value = '';readPending()
  shipTrackingNo.value = pending.value?.payload.trackingNo ?? props.order.trackingNo ?? ''
  shipCarrier.value = pending.value?.payload.carrier ?? props.order.carrier ?? ''
  shipLogisticsProduct.value = pending.value?.payload.logisticsProduct ?? props.order.logisticsProduct ?? ''
})
async function submitShip() {
  if (!props.order || !props.canShip || busy.value || storageError.value) return
  const operatorId = Number(app.authenticatedUser?.id);busy.value = true;error.value = ''
  try {
    if (!pending.value && recoveryOnly.value) {
      const result = await outboundApi.syncShipment(props.order.id)
      if (result.feePending || result.syncPending) { error.value = result.warning || '发运已保存，同步仍待核对，请再次重试同步';emit('pending');return }
      ElMessage.success('发运同步已核对，本次未扣库存或扣款')
    } else {
      const attempt = pending.value || JSON.parse(JSON.stringify({ outboundId: props.order.id, outboundNo: props.order.outboundNo || '', order: props.order,
        payload: { clientRequestId: crypto.randomUUID(), trackingNo: shipTrackingNo.value.trim(), carrier: shipCarrier.value.trim(), logisticsProduct: shipLogisticsProduct.value.trim() } }))
      if (!pending.value) { saveShipAttempt(localStorage, operatorId, attempt);readPending() }
      const response = await runShipAttempt(outboundApi, localStorage, operatorId, attempt)
      readPending()
      if (!response.completed) { error.value = response.message;emit('pending');return }
      ElMessage.success(response.message)
    }
    emit('update:modelValue', false);emit('success')
  } catch (e) { error.value = userFacingError(e);readPending();emit('pending') }
  finally { busy.value = false }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="`${recoveryOnly ? '核对发运同步' : '发运'} · ${order?.outboundNo || ''}`" width="520px"
    :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="emit('update:modelValue', $event)">
    <el-alert v-if="error || storageError" :title="error || storageError" type="error" :closable="false" />
    <el-alert v-if="pending" title="原发运请求已保留。请核对并重试原操作，勿修改物流资料后再次发运。" type="warning" :closable="false" />
    <p v-if="recoveryOnly" class="pick-hint">核对已保存的支付凭据，补发OMS费用、状态和库存同步，不再次扣库存或余额。</p>
    <template v-else>
      <p v-if="order?.omsActualFees" class="pick-hint">实测基础费用 ¥{{ Number(order.omsActualFees.actualTotal || 0).toFixed(2) }}，换标费按实际作业另计；预扣差额在发运时扣退。</p>
      <el-alert v-else-if="order?.omsPreDeduct" title="请先返回复核打包，完成实测计费后再发运。" type="warning" :closable="false" />
      <el-form label-width="80px" :disabled="busy || !!pending || !!storageError">
        <el-form-item label="跟踪号"><el-input v-model="shipTrackingNo" maxlength="50" placeholder="物流跟踪号（可选）" clearable /></el-form-item>
        <el-form-item label="物流产品"><el-select v-model="shipLogisticsProduct" clearable filterable allow-create placeholder="可选" style="width:100%"><el-option v-for="p in logisticsProducts" :key="p" :label="p" :value="p" /></el-select></el-form-item>
        <el-form-item label="承运商"><el-select v-model="shipCarrier" clearable filterable allow-create placeholder="可选" style="width:100%"><el-option v-for="c in carriers" :key="c" :label="c" :value="c" /></el-select></el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button :disabled="busy" @click="emit('update:modelValue', false)">{{ pending ? '返回列表并保留原操作' : '返回' }}</el-button>
      <el-button type="primary" :loading="busy" :disabled="!canShip || !!storageError || (!pending && !recoveryOnly && !!order?.omsPreDeduct && !order?.omsActualFees)" @click="submitShip">{{ pending ? '核对并重试原发运' : recoveryOnly ? '重试同步' : '确认发运' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pick-hint {
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.pick-hint.warn { color: var(--el-color-warning); }
</style>
