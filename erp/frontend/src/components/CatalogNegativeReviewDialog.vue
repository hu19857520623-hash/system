<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { pricingApi } from '@/api/client.js'
import { userFacingError } from '@erp/shared/user-facing-error'
import { erpConfirm } from '@/utils/messageBox'
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; updated: [] }>()
const visible = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) })
const rows = ref<any[]>([]), busy = ref(false), error = ref('')
async function load() {
  busy.value = true;error.value = ''
  try { rows.value = await pricingApi.negativePurchases() } catch(e) { error.value = userFacingError(e);rows.value = [] } finally { busy.value = false }
}
watch(() => props.modelValue, v => { if (v) void load() })
async function decide(row: any, decision: string) {
  if (busy.value) return
  try { await erpConfirm(decision === 'approved' ? `退回 ${-row.quantity} 件，按原单价退款 ¥${(-row.amount).toFixed(2)} 至 ${row.customerCode} 客户余额？` : '驳回该退回申请并释放可退额度？', '负申购审核') } catch { return }
  busy.value = true;error.value = ''
  try { const result=await pricingApi.decideNegative(row.id, decision);emit('updated');await load();if(result.syncPending) error.value=result.warning || '退回已入账，OMS通知待同步；请到退款记录重试同步' }
  catch(e) { error.value = `审核结果请先刷新核对，可重试原单，不会重复退款。${userFacingError(e)}` }
  finally { busy.value = false }
}
</script>
<template>
  <el-dialog v-model="visible" title="负申购审核（待审核）" width="1000px" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <p>审核通过后按原成交价退至客户余额，并冲减当前可用持有量。已出库商品须先办理实物退货入库。最多显示最近200条待审核申请。</p>
    <el-table :data="rows" v-loading="busy">
      <el-table-column prop="customerCode" label="客户" width="110" />
      <el-table-column prop="orderNo" label="原申购单" min-width="180" />
      <el-table-column prop="sku" label="SKU" min-width="120" />
      <el-table-column prop="quantity" label="负申购数量" width="110" />
      <el-table-column prop="unitPrice" label="原单价" width="90" />
      <el-table-column prop="amount" label="负金额" width="100" />
      <el-table-column prop="reason" label="原因" min-width="140" />
      <el-table-column label="操作" width="150"><template #default="{row}"><el-button link type="primary" :disabled="busy" @click="decide(row,'approved')">通过</el-button><el-button link type="danger" :disabled="busy" @click="decide(row,'rejected')">驳回</el-button></template></el-table-column>
    </el-table>
    <template #footer><el-button :disabled="busy" @click="load">刷新待审核</el-button></template>
  </el-dialog>
</template>
