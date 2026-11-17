<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { pricingApi } from '@/api/client.js'
import { userFacingError } from '@erp/shared/user-facing-error'
const props = defineProps<{ modelValue: boolean; pricingId: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; updated: [] }>()
const visible = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) })
const tiers = ['A','B','C','D'] as const
const prices = ref<Record<string, number | undefined>>({}), expected = ref<Record<string, number | null>>({})
const busy = ref(false), ready = ref(false), error = ref(''), remark = ref('')
async function load() {
  if (!props.pricingId || busy.value) return
  busy.value = true;ready.value = false;error.value = ''
  try {
    const row = await pricingApi.detail(props.pricingId)
    expected.value = { A: Number(row.finalPrice), B: row.priceB == null ? null : Number(row.priceB), C: row.priceC == null ? null : Number(row.priceC), D: row.priceD == null ? null : Number(row.priceD) }
    prices.value = Object.fromEntries(tiers.map(t => [t, expected.value[t] ?? undefined]));ready.value = true
  } catch (e) { error.value = userFacingError(e) } finally { busy.value = false }
}
watch(() => props.modelValue, v => { if (v) { remark.value = '';void load() } })
async function save() {
  if (busy.value || !ready.value || !props.pricingId) return
  busy.value = true;error.value = ''
  try {
    await pricingApi.setPrices(props.pricingId, { prices: Object.fromEntries(tiers.map(t => [t, prices.value[t] ?? null])), expectedPrices: expected.value, remark: remark.value })
    visible.value = false;emit('updated')
  } catch(e) { error.value = userFacingError(e) } finally { busy.value = false }
}
</script>
<template>
  <el-dialog v-model="visible" title="货盘四档价格" width="480px" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <p>A 档沿用基础售价；B/C/D 留空时，对应档位客户不能申购。历史成交价不受影响。</p>
    <el-form :disabled="busy || !ready" label-width="100px">
      <el-form-item v-for="tier in tiers" :key="tier" :label="tier + ' 档价格'">
        <el-input-number v-model="prices[tier]" :min="0.01" :max="9999999999.99" :precision="2" :controls="false" />
      </el-form-item>
      <el-form-item label="调整原因"><el-input v-model="remark" type="textarea" maxlength="500" /></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="busy" @click="load">读取最新价格</el-button><el-button type="primary" :disabled="!ready || !remark.trim()" :loading="busy" @click="save">保存四档价格</el-button></template>
  </el-dialog>
</template>
