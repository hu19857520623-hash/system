<script setup lang="ts">
import { ref, watch } from 'vue'
import { outboundApi } from '@/api/client.js'
import { withAction } from '@/composables/useListLoader.ts'

const props = defineProps<{
  modelValue: boolean
  order: {
    id: number
    outboundNo?: string
    trackingNo?: string | null
    carrier?: string | null
    logisticsProduct?: string | null
    omsActualFees?: { actualTotal?: number } | null
    omsPreDeduct?: { preDeductTotal?: number; destRegion?: string; priceTemplateName?: string } | null
  } | null
  canShip: boolean
  logisticsProducts: string[]
  carriers: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
}>()

const shipTrackingNo = ref('')
const shipCarrier = ref('')
const shipLogisticsProduct = ref('')

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible || !props.order) return
    shipTrackingNo.value = props.order.trackingNo || ''
    shipCarrier.value = props.order.carrier || ''
    shipLogisticsProduct.value = props.order.logisticsProduct || ''
  },
)

async function submitShip() {
  if (!props.order || !props.canShip) return
  await withAction(async () => {
    await outboundApi.ship(props.order!.id, {
      trackingNo: shipTrackingNo.value.trim() || undefined,
      carrier: shipCarrier.value.trim() || undefined,
      logisticsProduct: shipLogisticsProduct.value.trim() || undefined,
    })
    emit('update:modelValue', false)
    emit('success')
  }, `${props.order.outboundNo} 已发运，库存已扣减并生成计费`)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`发运 · ${order?.outboundNo || ''}`"
    width="460px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="order?.omsActualFees" class="pick-hint">
      实测实算 ¥{{ order.omsActualFees.actualTotal?.toFixed(2) }}（发运时将按此入账）
    </div>
    <div v-else-if="order?.omsPreDeduct" class="pick-hint warn">
      尚未完成实测实算，发运将使用旧版固定单价计费
    </div>
    <div v-if="order?.omsPreDeduct && !order?.omsActualFees" class="pick-hint">
      OMS 预扣合计 ¥{{ order.omsPreDeduct.preDeductTotal?.toFixed(2) }}
      <template v-if="order.omsPreDeduct.destRegion"> · 地区 {{ String(order.omsPreDeduct.destRegion).toUpperCase() }}</template>
      <template v-if="order.omsPreDeduct.priceTemplateName"> · 模板 {{ order.omsPreDeduct.priceTemplateName }}</template>
    </div>
    <el-form label-width="80px">
      <el-form-item label="跟踪号">
        <el-input v-model="shipTrackingNo" placeholder="物流跟踪号（可选）" clearable />
      </el-form-item>
      <el-form-item label="物流产品">
        <el-select v-model="shipLogisticsProduct" clearable filterable allow-create placeholder="可选" style="width:100%">
          <el-option v-for="p in logisticsProducts" :key="p" :label="p" :value="p" />
        </el-select>
      </el-form-item>
      <el-form-item label="承运商">
        <el-select v-model="shipCarrier" clearable filterable allow-create placeholder="可选" style="width:100%">
          <el-option v-for="c in carriers" :key="c" :label="c" :value="c" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="submitShip">确认发运</el-button>
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
