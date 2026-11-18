<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { customerApi, pricingApi } from '@/api/client.js'
import { userFacingError } from '@erp/shared/user-facing-error'
const props = defineProps<{ modelValue: boolean; customerId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; updated: [] }>()
const visible = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) })
const tier = ref('A'), expectedTier = ref('A'), busy = ref(false), ready = ref(false), error = ref('')
async function load() {
  if (!props.customerId || busy.value) return
  busy.value=true;ready.value=false;error.value=''
  try { const row=await customerApi.detail(props.customerId);tier.value=row.catalogPriceTier ?? 'A';expectedTier.value=tier.value;ready.value=true }
  catch(e) { error.value=userFacingError(e) } finally { busy.value=false }
}
watch(() => props.modelValue, v => { if(v) void load() })
async function save() {
  if (!ready.value || busy.value) return
  busy.value=true;error.value=''
  try { await pricingApi.setCustomerTier(props.customerId, { tier:tier.value, expectedTier:expectedTier.value });visible.value=false;emit('updated') }
  catch(e) { error.value=userFacingError(e) } finally { busy.value=false }
}
</script>
<template>
  <el-dialog v-model="visible" title="客户货盘价格档位" width="440px" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <p>该客户新申购使用绑定档位；历史单据和退回金额使用原成交价。原有客户默认 A 档。</p>
    <el-select v-model="tier" :disabled="busy || !ready"><el-option v-for="t in ['A','B','C','D']" :key="t" :value="t" :label="t+' 档价格'" /></el-select>
    <template #footer><el-button :disabled="busy" @click="load">读取最新档位</el-button><el-button type="primary" :loading="busy" :disabled="!ready" @click="save">保存绑定</el-button></template>
  </el-dialog>
</template>
